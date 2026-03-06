(function () {
  "use strict";

  // ==============================
  // 設定値
  // ==============================

  const mapEnabled = false;

  // APIエンドポイント一覧（取得順に $.when へ渡す）
  const ACTION_URLS = [
    "signagecontrolinfo",
    "signagefacilityinfo?display_frequency=A",
    "signagefacilityinfo?display_frequency=B",
    "signagefacilityinfo?display_frequency=C",
  ];

  // 施設データ（配列）の各フィールドに対応するインデックス
  const DATA_INDEX = {
    CORP: 0,      // 法人名
    NAME: 1,      // 施設名
    ADDRESS: 2,   // 住所
    SERVICE: 3,   // 診療科目
    PR: 4,        // PRテキスト
    IMAGE1: 5,    // 画像URL1
    IMAGE2: 6,    // 画像URL2
    LAT: 7,       // 緯度（地図表示用）
    LON: 8,       // 経度（地図表示用）
  };

  const MAX_RETRY = 6;           // Ajax失敗時の最大リトライ回数
  const RETRY_INTERVAL = 10000;  // リトライ間隔（ミリ秒）
  const AJAX_TIMEOUT = 60000;    // Ajaxタイムアウト（ミリ秒）

  // ==============================
  // 状態管理
  // ==============================

  const state = {
    facilityData: [],        // 表示順に並べた施設データの配列
    groups: [],              // グループごとの元施設リストと表示頻度（mode=2の再シャッフルで使用）
    lastIndex: 0,            // facilityData の最終インデックス
    currentIndex: 0,         // 現在表示中のインデックス
    intervalId: null,        // スライドショーのタイマーID
    imageBackgroundColor: "", // 画像エリアの背景色（テーマカラーに合わせる）
  };

  const ajaxState = {
    retryCount: 0,  // 現在のリトライ回数
    messageLog: "", // エラーメッセージの蓄積ログ
  };

  // ==============================
  // DOMキャッシュ
  // ==============================

  const elements = {};

  function cacheDomElements() {
    elements.loader = document.getElementById("loader");
    elements.name = document.getElementById("name");
    elements.address = document.getElementById("address");
    elements.service = document.getElementById("service");
    elements.pr = document.getElementById("pr");
    elements.prContainer = document.getElementById("prContainer");
    elements.image1 = document.getElementById("image1");
    elements.image2 = document.getElementById("image2");
  }

  // ==============================
  // 共通ユーティリティ
  // ==============================

  // ブラウザキャッシュを防ぐため、URLに1分単位のタイムスタンプを付加する
  function addCacheBusting(url) {
    const separator = url.includes("?") ? "&" : "?";
    const timestamp = Math.floor(Date.now() / 60000);
    return `${url}${separator}v=${timestamp}`;
  }

  // Fisher-Yates アルゴリズムで配列をインプレースにシャッフルする
  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  // facilityData 内のグループ A/B/C それぞれをグループ内のみ再シャッフルして上書きする。
  // 「元施設リストをシャッフル → freq 回繰り返し」の順で再構築するため、
  // フラット配列をそのままシャッフルすることによる重複の偏りが生じない。
  // グループをまたいだ順序の入れ替えは行わない。
  function shuffleGroups() {
    let offset = 0;
    for (const { facilities, freq } of state.groups) {
      const shuffled = [...facilities];
      shuffleArray(shuffled);
      const repeated = [];
      for (let i = 0; i < freq; i++) {
        repeated.push(...shuffled);
      }
      state.facilityData.splice(offset, repeated.length, ...repeated);
      offset += repeated.length;
    }
  }

  // 指定URLの画像が実際に存在するかを非同期で確認し、結果をコールバックで返す
  function checkImageExists(url, callback) {
    const img = new Image();
    img.onload = () => callback(true);
    img.onerror = () => callback(false);
    img.src = url;
  }

  // テキストがはみ出さない最大フォントサイズを1pxずつ増やして探索し適用する
  function setFontSize(elem, maxWidth, maxHeight, minFont, maxFont) {
    if (!elem.textContent.trim()) return;
    for (let size = minFont; size <= maxFont; size++) {
      elem.style.fontSize = `${size}px`;
      if (elem.offsetWidth > maxWidth || elem.offsetHeight > maxHeight) {
        elem.style.fontSize = `${size - 1}px`;
        break;
      }
    }
  }

  // 画面左上にエラーメッセージを赤背景で表示する
  function showMessage(message) {
    elements.loader.style.display = "none";
    const div = document.createElement("div");
    div.style.position = "fixed";
    div.style.left = "5px";
    div.style.top = "5px";
    div.style.backgroundColor = "#f00";
    div.style.border = "solid 1px #fff";
    div.style.padding = "5px";
    div.innerHTML = message;
    document.body.appendChild(div);
  }

  // ==============================
  // クエリ解析
  // ==============================

  function parseQueryParameter() {
    const result = {
      cd: null,          // 施設コード（例: h139999996）
      dur: 15000,        // 1施設あたりの表示時間（ミリ秒）。クエリは秒単位で指定
      group: null,       // 表示グループ絞り込み: A | B | C | null（null=全グループ）
      mode: 0,           // 表示順モード: 0=順番, 1=初回のみシャッフル, 2=1周ごとに再シャッフル
    };

    const queryString = location.search.substring(1);
    if (!queryString) return result;

    queryString.split("&").forEach((param) => {
      const [key, value] = param.split("=");
      if (!value) return;

      switch (key) {
        case "cd":
          // 形式チェック: h + 9桁の数字
          if (/^h\d{9}$/.test(value)) result.cd = value;
          break;
        case "dur":
          // 1〜999秒の範囲のみ受け付け、ミリ秒に変換して保持
          if (/^([1-9][0-9]{0,2})$/.test(value))
            result.dur = Number(value) * 1000;
          break;
        case "group":
          if (/^[ABC]$/.test(value))
            result.group = value;
          break;
        case "mode":
          if (/^[012]$/.test(value))
            result.mode = Number(value);
          break;
      }
    });

    return result;
  }

  const queryParameter = parseQueryParameter();

  // ==============================
  // Ajax生成
  // ==============================

  function createAjaxRequests(cd) {
    return ACTION_URLS.map((endpoint) =>
      $.ajax({
        cache: false,
        type: "get",
        url: addCacheBusting(`/${cd}/api/${endpoint}`),
        timeout: AJAX_TIMEOUT,
      })
    );
  }

  function init() {
    clearInterval(state.intervalId);
    const requests = createAjaxRequests(queryParameter.cd);

    // 全リクエストが揃ってから処理を開始する
    $.when.apply($, requests)
      .done((controlInfoRes, groupARes, groupBRes, groupCRes) =>
        handleAjaxSuccess(controlInfoRes, groupARes, groupBRes, groupCRes)
      )
      .fail(handleAjaxFailure);
  }

  // ==============================
  // Ajax成功処理
  // ==============================

  function handleAjaxSuccess(controlInfoRes, groupARes, groupBRes, groupCRes) {
    // jQueryの $.when は各レスポンスを [data, textStatus, jqXHR] の配列で渡すため [0] で本体を取り出す
    const controlInfo = JSON.parse(controlInfoRes[0]);
    const facilitiesA = JSON.parse(groupARes[0]);
    const facilitiesB = JSON.parse(groupBRes[0]);
    const facilitiesC = JSON.parse(groupCRes[0]);

    state.imageBackgroundColor = controlInfo.backgroundColor;

    buildFacilityData(controlInfo, facilitiesA, facilitiesB, facilitiesC);

    state.lastIndex = state.facilityData.length - 1;

    if (state.lastIndex >= 0) {
      startDisplay(controlInfo);
    } else {
      showMessage("表示するデータがありません。");
    }
  }

  function handleAjaxFailure(jqXHR, textStatus) {
    if (ajaxState.retryCount < MAX_RETRY) {
      ajaxState.retryCount++;
      ajaxState.messageLog += `
        ${new Date()}<br>
        Ajax communication failed. Retry=${ajaxState.retryCount}/${MAX_RETRY}<br>
        Status:&thinsp;${textStatus}<br>
        Code:&thinsp;${jqXHR.status}<br>
        Description:&thinsp;${jqXHR.statusText}<br><br>
      `;
      setTimeout(init, RETRY_INTERVAL);
    } else {
      showMessage(ajaxState.messageLog);
    }
  }

  // ==============================
  // データ構築
  // ==============================

  function buildFacilityData(controlInfo, facilitiesA, facilitiesB, facilitiesC) {
    state.facilityData = [];
    state.groups = [];

    const group = queryParameter.group;

    // mode=1,2 のときはグループ内をシャッフルする（グループ間の順序は変えない）
    const doShuffle = queryParameter.mode !== 0;

    // group指定あり → 該当グループのみ対象とする
    // group未指定 → グループ A/B/C を順に結合し、表示頻度に応じて繰り返す
    const allGroupDefs = [
      { facilities: facilitiesA, freq: controlInfo.displayFrequencyA },
      { facilities: facilitiesB, freq: controlInfo.displayFrequencyB },
      { facilities: facilitiesC, freq: controlInfo.displayFrequencyC },
    ];
    const groupMap = { A: allGroupDefs[0], B: allGroupDefs[1], C: allGroupDefs[2] };
    // group指定時は表示頻度を無視して1周のみ
    const groupDefs = group ? [{ ...groupMap[group], freq: 1 }] : allGroupDefs;

    for (const { facilities, freq } of groupDefs) {
      // mode=2 の再シャッフル（shuffleGroups）のために元リストと頻度を保存する
      state.groups.push({ facilities: [...facilities], freq });

      // 初回表示用: シャッフル（任意）してから freq 回繰り返して追加する
      const shuffled = [...facilities];
      if (doShuffle) shuffleArray(shuffled);
      for (let i = 0; i < freq; i++) {
        state.facilityData.push(...shuffled);
      }
    }
  }

  // ==============================
  // 表示処理
  // ==============================

  function startDisplay(controlInfo) {
    elements.loader.style.display = "none";
    document.getElementById("guide-back").style.backgroundColor = controlInfo.backgroundColor;
    document.getElementById("guide-wrapper").style.borderColor = controlInfo.backgroundColor;
    const labels = document.getElementsByClassName("table-label");
    for (let i = 0; i < labels.length; i++) {
      labels[i].style.backgroundColor = controlInfo.backgroundColor;
    }

    state.currentIndex = 0;
    showData();

    // dur ミリ秒ごとにフェードアウト → showData → フェードインを繰り返す
    state.intervalId = setInterval(() => {
      $("#dynamicData").fadeTo(1000, 0, showData);
    }, queryParameter.dur);
  }

  function showData() {
    const data = state.facilityData[state.currentIndex];
    renderText(data);
    renderPR(data);
    renderImages(data);
    updateIndex();
    $("#dynamicData").fadeTo(1000, 1);
  }

  function updateIndex() {
    if (queryParameter.mode === 0 || queryParameter.mode === 1) {
      // mode=0,1: 末尾まで来たら先頭に戻る（ループ）
      state.currentIndex =
        (state.currentIndex + 1) % (state.lastIndex + 1);
    } else if (queryParameter.mode === 2) {
      // mode=2: 末尾まで来たらグループ内を再シャッフルして先頭に戻る
      state.currentIndex++;
      if (state.currentIndex > state.lastIndex) {
        shuffleGroups();
        state.currentIndex = 0;
      }
    }
  }

  function renderText(data) {
    // 法人名が空の場合は施設名のみ、それ以外は「法人名 施設名」として表示する
    const corp = data[DATA_INDEX.CORP];
    const name = data[DATA_INDEX.NAME];
    elements.name.textContent = corp.length === 0 ? name : `${corp} ${name}`;
    elements.address.textContent = data[DATA_INDEX.ADDRESS];
    elements.service.textContent = data[DATA_INDEX.SERVICE];

    setFontSize(elements.name, 1860, 100, 24, 100);
  }

  function renderPR(data) {
    const prText = data[DATA_INDEX.PR];

    // PRテキストがない場合もデフォルトテキストを表示する
    elements.pr.textContent = prText || "当院の登録医療機関です。";
    elements.prContainer.style.visibility = "visible";

    if (!prText) {
      setFontSize(elements.pr, 1032, 280, 18, 52);
    } else {
      setFontSize(elements.pr, 1032, 260, 18, 52);
    }

    setFontSize(elements.address, 1032, 150, 18, 52);
    setFontSize(elements.service, 1032, 210, 18, 52);
  }

  function renderImages(data) {
    resetImages();

    const img1 = data[DATA_INDEX.IMAGE1];
    const img2 = data[DATA_INDEX.IMAGE2];

    if (!img1 && !img2) {
      renderNoImage(data);
      return;
    }

    if (img1) applyImage(elements.image1, img1);
    if (img2) applyImage(elements.image2, img2);
  }

  function resetImages() {
    [elements.image1, elements.image2].forEach((img) => {
      img.style.display = "none";
      img.style.backgroundColor = "";
    });
  }

  function applyImage(element, url) {
    element.style.backgroundImage = `url('${addCacheBusting(url)}')`;
    element.style.display = "inline-block";
  }

  function renderNoImage(data) {
    if (!mapEnabled) {
      // 施設コード固有のNO IMAGE画像を優先表示し、なければ病院向け共通画像を使う
      const backgroundImage =
        `/assets/img/noimage_${queryParameter.cd}.png`;

      checkImageExists(addCacheBusting(backgroundImage), (exists) => {
        const url = exists
          ? backgroundImage
          : "/assets/img/noimage_h.png";

        applyImage(elements.image1, url);
        elements.image1.style.backgroundColor = state.imageBackgroundColor;
      });
    } else {
      // 地図モード: Yahoo Static Map API で施設位置の地図画像を表示する
      const lat = data[DATA_INDEX.LAT];
      const lon = data[DATA_INDEX.LON];

      const mapUrl =
        `http://map.olp.yahooapis.jp/OpenLocalPlatform/V1/static` +
        `?appid=dj0zaiZpPXRqZ3lTOFFkeEpGSSZkPVlXazlWRXc0UkRsaE5IVW1jR285TUEtLSZzPWNvbnN1bWVyc2VjcmV0Jng9MjY-` +
        `&z=20&lat=${lat}&lon=${lon}&width=400&height=300&pin=${lat},${lon}`;

      applyImage(elements.image1, mapUrl);
    }
  }

  // ==============================
  // 起動処理
  // ==============================

  window.onload = function () {
    cacheDomElements();

    if (queryParameter.cd !== null) {
      ajaxState.retryCount = 0;
      init();
    } else {
      showMessage("パラメーターが正しくありません。");
    }
  };
})();

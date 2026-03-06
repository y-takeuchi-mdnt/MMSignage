(function () {
  "use strict";

  // ==============================
  // 設定値
  // ==============================

  const mapEnabled = false;

  const ACTION_URLS = [
    "signagecontrolinfo",
    "signagefacilityinfo?display_frequency=A",
    "signagefacilityinfo?display_frequency=B",
    "signagefacilityinfo?display_frequency=C",
  ];

  const DATA_INDEX = {
    CORP: 0,
    NAME: 1,
    ADDRESS: 2,
    SERVICE: 3,
    PR: 4,
    IMAGE1: 5,
    IMAGE2: 6,
    LAT: 7,
    LON: 8,
  };

  const MAX_RETRY = 6;
  const RETRY_INTERVAL = 10000;
  const AJAX_TIMEOUT = 60000;

  // ==============================
  // 状態管理
  // ==============================

  const state = {
    facilityData: [],
    groupSizes: [],
    lastIndex: 0,
    currentIndex: 0,
    intervalId: null,
  };

  const ajaxState = {
    retryCount: 0,
    messageLog: "",
  };

  // ==============================
  // DOMキャッシュ
  // ==============================

  const elements = {};

  function cacheDomElements() {
    elements.loader = document.getElementById("loader");
    elements.corp = document.getElementById("corp");
    elements.name = document.getElementById("name");
    elements.address = document.getElementById("address");
    elements.service = document.getElementById("service");
    elements.serviceContainer = document.getElementById("serviceContainer");
    elements.pr = document.getElementById("pr");
    elements.prContainer = document.getElementById("prContainer");
    elements.image1 = document.getElementById("image1");
    elements.image2 = document.getElementById("image2");
  }

  // ==============================
  // 共通ユーティリティ
  // ==============================

  function addCacheBusting(url) {
    const separator = url.includes("?") ? "&" : "?";
    const timestamp = Math.floor(Date.now() / 60000);
    return `${url}${separator}v=${timestamp}`;
  }

  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  function shuffleGroups() {
    let offset = 0;
    for (const size of state.groupSizes) {
      if (size > 0) {
        const slice = state.facilityData.slice(offset, offset + size);
        shuffleArray(slice);
        state.facilityData.splice(offset, size, ...slice);
        offset += size;
      }
    }
  }

  // 施設リストをシャッフル（任意）してから、表示頻度の回数分 facilityData に追加する。
  // displayFrequency: 表示頻度設定（1〜3）。値が大きいほど表示回数が多くなる。
  function appendFacilitiesWithFrequency(facilities, displayFrequency, doShuffle) {
    const shuffled = [...facilities];
    if (doShuffle) shuffleArray(shuffled);
    for (let i = 0; i < displayFrequency; i++) {
      state.facilityData.push(...shuffled);
    }
  }

  function checkImageExists(url, callback) {
    const img = new Image();
    img.onload = () => callback(true);
    img.onerror = () => callback(false);
    img.src = url;
  }

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
      cd: null,
      dur: 15000,
      pattern: null, // A | B | C | null
      mode: 0, // 0=順番表示,1=初回のみシャッフル,2=1周ごとに再シャッフル
    };

    const queryString = location.search.substring(1);
    if (!queryString) return result;

    queryString.split("&").forEach((param) => {
      const [key, value] = param.split("=");
      if (!value) return;

      switch (key) {
        case "cd":
          if (/^h\d{9}$/.test(value)) result.cd = value;
          break;
        case "dur":
          if (/^([1-9][0-9]{0,2})$/.test(value))
            result.dur = Number(value) * 1000;
          break;
        case "pattern":
          if (/^[ABC]$/.test(value))
            result.pattern = value;
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
    const controlInfo = JSON.parse(controlInfoRes[0]);
    const facilitiesA = JSON.parse(groupARes[0]);
    const facilitiesB = JSON.parse(groupBRes[0]);
    const facilitiesC = JSON.parse(groupCRes[0]);

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
    state.groupSizes = [];

    const pattern = queryParameter.pattern;

    // pattern指定あり → frequency無視
    if (pattern) {
      if (pattern === "A") state.facilityData = [...facilitiesA];
      if (pattern === "B") state.facilityData = [...facilitiesB];
      if (pattern === "C") state.facilityData = [...facilitiesC];
      return;
    }

    // pattern未指定 → frequency適用
    const doShuffle = queryParameter.mode !== 0;

    let before;
    before = state.facilityData.length;
    appendFacilitiesWithFrequency(facilitiesA, controlInfo.displayFrequencyA, doShuffle);
    state.groupSizes.push(state.facilityData.length - before);

    before = state.facilityData.length;
    appendFacilitiesWithFrequency(facilitiesB, controlInfo.displayFrequencyB, doShuffle);
    state.groupSizes.push(state.facilityData.length - before);

    before = state.facilityData.length;
    appendFacilitiesWithFrequency(facilitiesC, controlInfo.displayFrequencyC, doShuffle);
    state.groupSizes.push(state.facilityData.length - before);
  }

  // ==============================
  // 表示処理
  // ==============================

  function startDisplay(controlInfo) {
    elements.loader.style.display = "none";
    document.documentElement.style.backgroundColor =
      controlInfo.backgroundColor;
    document.body.style.backgroundColor =
      controlInfo.backgroundColor;

    state.currentIndex = 0;
    showData();

    state.intervalId = setInterval(() => {
      $("#wrapper").fadeTo(1000, 0, showData);
    }, queryParameter.dur);
  }

  function showData() {
    const data = state.facilityData[state.currentIndex];
    renderText(data);
    renderPR(data);
    renderImages(data);
    updateIndex();
    $("#wrapper").fadeTo(1000, 1);
  }

  function updateIndex() {
    if (queryParameter.mode === 0 || queryParameter.mode === 1) {
      state.currentIndex =
        (state.currentIndex + 1) % (state.lastIndex + 1);
    } else if (queryParameter.mode === 2) {
      state.currentIndex++;
      if (state.currentIndex > state.lastIndex) {
        shuffleGroups();
        state.currentIndex = 0;
      }

    }
  }

  function renderText(data) {
    elements.corp.textContent = data[DATA_INDEX.CORP];
    elements.name.textContent = data[DATA_INDEX.NAME];
    elements.address.textContent = data[DATA_INDEX.ADDRESS];

    elements.service.style.fontSize = "36px";
    elements.service.textContent = data[DATA_INDEX.SERVICE];

    setFontSize(elements.name, 1016, 96, 1, 96);
  }

  function renderPR(data) {
    const prText = data[DATA_INDEX.PR];

    if (!prText) {
      elements.prContainer.style.visibility = "hidden";

      if (elements.serviceContainer.offsetHeight > 450) {
        setFontSize(elements.service, 856, 450, 1, 36);
      }
      return;
    }

    elements.pr.textContent = prText;
    elements.prContainer.style.visibility = "visible";

    setFontSize(elements.pr, 856, 250, 1, 36);
    setFontSize(elements.service, 856, 150, 1, 36);
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
      const backgroundImage =
        `/assets/img/noimage_${queryParameter.cd}.png`;

      checkImageExists(addCacheBusting(backgroundImage), (exists) => {
        const url = exists
          ? backgroundImage
          : "/assets/img/noimage.png";

        applyImage(elements.image1, url);
        elements.image1.style.backgroundColor = "transparent";
      });
    } else {
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
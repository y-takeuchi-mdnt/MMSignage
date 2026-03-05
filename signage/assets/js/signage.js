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
      order: 0,      // 0=sequential, 1=random
    };

    const queryString = location.search.substring(1);
    if (!queryString) return result;

    const params = queryString.split("&");

    params.forEach((p) => {
      const [key, value] = p.split("=");
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

        case "order":
          if (/^[01]$/.test(value))
            result.order = Number(value);
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
      .done((sci, freqA, freqB, freqC) =>
        handleAjaxSuccess(sci, freqA, freqB, freqC)
      )
      .fail(handleAjaxFailure);
  }

  // ==============================
  // Ajax成功処理
  // ==============================

  function handleAjaxSuccess(sci, freqA, freqB, freqC) {
    const controlInfo = JSON.parse(sci[0]);
    const dataA = JSON.parse(freqA[0]);
    const dataB = JSON.parse(freqB[0]);
    const dataC = JSON.parse(freqC[0]);

    buildFacilityData(controlInfo, dataA, dataB, dataC);

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

  function buildFacilityData(controlInfo, dataA, dataB, dataC) {
    state.facilityData = [];

    const p = queryParameter.pattern;

    if (!p || p === "A")
      repeatAddData(dataA, controlInfo.displayFrequencyA);

    if (!p || p === "B")
      repeatAddData(dataB, controlInfo.displayFrequencyB);

    if (!p || p === "C")
      repeatAddData(dataC, controlInfo.displayFrequencyC);
  }

  function repeatAddData(data, count) {
    for (let i = 0; i < count; i++) {
      state.facilityData.push(...data);
    }
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
    if (queryParameter.order === 1) {
      state.currentIndex = Math.floor(
        Math.random() * (state.lastIndex + 1)
      );
    } else {
      state.currentIndex =
        (state.currentIndex + 1) % (state.lastIndex + 1);
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
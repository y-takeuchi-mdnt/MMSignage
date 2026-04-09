// =============================================
// ■ IE11専用スクリプト（ES5版）
// =============================================
//
// 本ファイルはInternet Explorer 11向けの互換実装である。
// モダンブラウザ用（ES6版）は別ファイルで管理している。
// signage.html
// signage.js
// signage_h.html
// signage_h.js
//
// ---------------------------------------------
// ■ 背景
// ---------------------------------------------
// IE11は以下のES6機能に非対応のため、
// 通常版（signage.js）はそのままでは動作しない。
// ・テンプレートリテラル（`）
// ・アロー関数（=>）
// ・スプレッド構文（...）
// ・分割代入
// ・const / let（一部制限あり）
//
// そのため本ファイルではES5構文で再実装している。
//
// ---------------------------------------------
// ■ 機能制限（重要）
// ---------------------------------------------
// 本ファイルでは一部機能を簡略化している。
// 以下のクエリパラメーターは未対応とする。
//
// ・group（グループ絞り込み）
// ・mode（表示順制御 / シャッフル制御）
//
// これらが指定されている場合でも、
// すべて「未指定」として扱う（全グループ・順次表示）。
//
// ---------------------------------------------
// ■ 運用ルール
// ---------------------------------------------
// ・基本はES6版（signage.js）を正とする
// ・本ファイルはIE11対応のための最小限の追従のみ行う
// ・仕様変更時はES6版を先に修正し、必要に応じて本ファイルへ反映する
// ・不要なロジック追加や独自拡張は行わない
//
// ---------------------------------------------
// ■ 読み分け
// ---------------------------------------------
// IE11ユーザーのみ本ファイルを読み込むように制御すること
// （UserAgent判定またはJSによる動的読み込み）
//
// ---------------------------------------------
// ■ 動作確認手順
// ---------------------------------------------
// 1. Edgeを開く
// 2. 設定 → 「既定のブラウザー」
// 3. 「Internet Explorer モードページ」に対象URLを追加
// 4. IEモードでサイトへアクセス
// 5. 開発者ツール起動：
//    C:\Windows\System32\F12\IEChooser.exe
//
// ---------------------------------------------
// ■ 注意事項
// ---------------------------------------------
// ・ES6構文を誤って記述しないこと
// ・古いブラウザのためパフォーマンスや機能制限あり
// ・将来的にIE11サポートは廃止される可能性がある
//
// =============================================
var mapEnabled = false;
var actionURL = [
  "signagecontrolinfo",
  "signagefacilityinfo?display_frequency=A",
  "signagefacilityinfo?display_frequency=B",
  "signagefacilityinfo?display_frequency=C",
];
var jqXHRList;
var facilityData;
var maxIndex;
var curtIndex;
var intervalID;
var retryCount;
var elemLoader;
var elemCorp;
var elemName;
var elemAddress;
var elemService;
var elemPR;
var elemPRContainer;
var elemImage1;
var elemImage2;
var ajaxMessage = "";

// キャッシュバスティング用関数
// デプロイ時に更新
function addCacheBusting(url) {
  var separator = url.indexOf("?") !== -1 ? "&" : "?";
  // 分単位のタイムスタンプ（1分間はキャッシュされる）
  var timestamp = Math.floor(new Date().getTime() / 60000);
  return url + separator + "v=" + timestamp;
}

var queryParameter = (function () {
  var obj = {
    cd: null,
    dur: 15000,
  };

  var url = location.href.split("?");
  if (url.length != 2) return obj;

  var query = url[1].split("&");
  if (query.length < 1) return obj;

  for (var i = 0, len = query.length; i < len; i++) {
    var param = query[i].split("=");
    if (param.length == 2) {
      switch (param[0]) {
        case "cd":
          if (/^h\d{9}$/.test(param[1])) obj.cd = param[1];
          break;
        case "dur":
          if (/^([1-9][0-9]{0,2})$/.test(param[1])) obj.dur = param[1] * 1000;
          break;
      }
    }
  }

  return obj;
})();

window.onload = function () {
  elemLoader = document.getElementById("loader");

  if (queryParameter.cd !== null) {
    elemCorp = document.getElementById("corp");
    elemName = document.getElementById("name");
    elemAddress = document.getElementById("address");
    elemService = document.getElementById("service");
    elemServiceContainer = document.getElementById("serviceContainer");
    elemPR = document.getElementById("pr");
    elemPRContainer = document.getElementById("prContainer");
    elemImage1 = document.getElementById("image1");
    elemImage2 = document.getElementById("image2");

    jqXHRList = [];
    for (var i = 0; i < actionURL.length; i++) {
      jqXHRList.push(
        $.ajax({
          cache: false,
          type: "get",
          url: addCacheBusting("/" + queryParameter.cd + "/api/" + actionURL[i]),
          timeout: 60000,
        })
      );
    }

    retryCount = 0;
    init();
  } else {
    showMessage("パラメーターが正しくありません。");
  }
};

function init() {
  clearInterval(intervalID);

  $.when
    .apply($, jqXHRList)
    .done(function (sci, freqA, freqB, freqC) {
      sci = JSON.parse(sci[0]);
      freqA = JSON.parse(freqA[0]);
      freqB = JSON.parse(freqB[0]);
      freqC = JSON.parse(freqC[0]);

      facilityData = [];
      for (var i = 0; i < sci.displayFrequencyA; i++) {
        addData(freqA);
      }
      for (var i = 0; i < sci.displayFrequencyB; i++) {
        addData(freqB);
      }
      for (var i = 0; i < sci.displayFrequencyC; i++) {
        addData(freqC);
      }

      maxIndex = facilityData.length - 1;

      if (maxIndex >= 0) {
        elemLoader.style.display = "none";
        document.getElementsByTagName("html")[0].style.backgroundColor = sci.backgroundColor;
        document.getElementsByTagName("body")[0].style.backgroundColor = sci.backgroundColor;

        curtIndex = 0;
        showData();

        intervalID = setInterval(function () {
          $("#wrapper").fadeTo(1000, 0, showData);
        }, queryParameter.dur);
      } else {
        showMessage("表示するデータがありません。");
      }
    })
    .fail(function (jqXHR, textStatus, errorThrown) {
      if (retryCount < 6) {
        retryCount++;
        ajaxMessage +=
          new Date() +
          "<br>Ajax communication failed. Retry=" +
          retryCount +
          "/6<br>Status:&thinsp;" +
          textStatus +
          "<br>Code:&thinsp;" +
          jqXHR.status +
          "<br>Description:&thinsp;" +
          jqXHR.statusText +
          "<br><br>";
        setTimeout(init, 10000);
      } else {
        showMessage(ajaxMessage);
      }
    });
}

function addData(o) {
  for (var i = 0, len = o.length; i < len; i++) {
    facilityData.push(o[i]);
  }
}

function showData() {
  elemCorp.textContent = facilityData[curtIndex][0];
  elemName.textContent = facilityData[curtIndex][1];
  elemAddress.textContent = facilityData[curtIndex][2];
  elemService.style.fontSize = "36px";
  elemService.textContent = facilityData[curtIndex][3];

  if (facilityData[curtIndex][4].length == 0) {
    elemPRContainer.style.visibility = "hidden";
    if (elemServiceContainer.offsetHeight > 450) {
      setFontSize(elemService, 856, 450, 1, 36);
    }
  } else {
    elemPR.textContent = facilityData[curtIndex][4];
    elemPRContainer.style.visibility = "visible";
    setFontSize(elemPR, 856, 250, 1, 36);
    setFontSize(elemService, 856, 150, 1, 36);
  }

  setFontSize(elemName, 1016, 96, 1, 96);

  elemImage1.style.display = "none";
  elemImage2.style.display = "none";
  elemImage1.style.backgroundColor = "";
  elemImage2.style.backgroundColor = "";

  if (facilityData[curtIndex][5].length == 0 && facilityData[curtIndex][6].length == 0) {
    if (mapEnabled == false) {
      var backgroundImage = "/assets/img/noimage_" + queryParameter.cd + ".png";
      checkImageExists(addCacheBusting(backgroundImage), function (exists) {
        if (exists) {
          elemImage1.style.backgroundImage = "url('" + addCacheBusting(backgroundImage) + "')";
        } else {
          elemImage1.style.backgroundImage = "url('" + addCacheBusting("/assets/img/noimage.png") + "')";
        }
        elemImage1.style.backgroundColor = "transparent";
      });
    } else {
      elemImage1.style.backgroundImage =
        "url('http://map.olp.yahooapis.jp/OpenLocalPlatform/V1/static?appid=dj0zaiZpPXRqZ3lTOFFkeEpGSSZkPVlXazlWRXc0UkRsaE5IVW1jR285TUEtLSZzPWNvbnN1bWVyc2VjcmV0Jng9MjY-&z=20&lat=" +
        facilityData[curtIndex][7] +
        "&lon=" +
        facilityData[curtIndex][8] +
        "&width=400&height=300&pin=" +
        facilityData[curtIndex][7] +
        "," +
        facilityData[curtIndex][8] +
        "')";
    }
    elemImage1.style.display = "inline-block";
  } else {
    if (facilityData[curtIndex][5].length > 0) {
      elemImage1.style.backgroundImage = "url('" + addCacheBusting(facilityData[curtIndex][5]) + "')";
      elemImage1.style.display = "inline-block";
    }
    if (facilityData[curtIndex][6].length > 0) {
      elemImage2.style.backgroundImage = "url('" + addCacheBusting(facilityData[curtIndex][6]) + "')";
      elemImage2.style.display = "inline-block";
    }
  }

  if (curtIndex >= maxIndex) {
    curtIndex = 0;
  } else {
    curtIndex++;
  }

  $("#wrapper").fadeTo(1000, 1);
}

function checkImageExists(url, callback) {
  const img = new Image();
  img.onload = function () {
    callback(true);
  };
  img.onerror = function () {
    callback(false);
  };
  img.src = url;
}

function setFontSize(elem, maxWidth, maxHeight, minFont, maxFont) {
  if (elem.textContent.trim().length > 0) {
    for (var i = minFont; i <= maxFont; i++) {
      elem.style.fontSize = i + "px";
      if (elem.offsetWidth > maxWidth || elem.offsetHeight > maxHeight) {
        elem.style.fontSize = i - 1 + "px";
        break;
      }
    }
  }
}

function showMessage(message) {
  elemLoader.style.display = "none";
  var elem = document.createElement("div");
  elem.style.position = "fixed";
  elem.style.left = "5px";
  elem.style.top = "5px";
  elem.style.backgroundColor = "#f00";
  elem.style.border = "solid 1px #fff";
  elem.style.padding = "5px";
  elem.innerHTML = message;
  document.body.appendChild(elem);
}

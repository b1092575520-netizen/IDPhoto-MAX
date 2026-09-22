(function () {
  "use strict";

  var CANVAS_WIDTH_CM = 15.24;
  var CANVAS_HEIGHT_CM = 10.16;
  var CANVAS_PPI = 600;
  var CANVAS_WIDTH_PX = 3600;
  var CANVAS_HEIGHT_PX = 2400;
  var TEST_DOCUMENT_NAME = "证件照排版_测试";

  function getPhotoshopModule() {
    if (!window.IDPhotoPhotoshopExecution) {
      throw new Error("photoshopExecution 未加载");
    }
    return window.IDPhotoPhotoshopExecution.getPhotoshop();
  }

  function makeCreateOptions(name) {
    return {
      width: CANVAS_WIDTH_PX,
      height: CANVAS_HEIGHT_PX,
      resolution: CANVAS_PPI,
      mode: "RGBColorMode",
      fill: "white",
      name: name || TEST_DOCUMENT_NAME
    };
  }

  function makeMinimalCreateOptions(name) {
    return {
      width: CANVAS_WIDTH_PX,
      height: CANVAS_HEIGHT_PX,
      resolution: CANVAS_PPI,
      name: name || TEST_DOCUMENT_NAME
    };
  }

  async function createDocumentWithDom(app, options) {
    var minimalOptions = makeMinimalCreateOptions(options.name);
    var firstError = null;

    if (app.documents && typeof app.documents.add === "function") {
      try {
        return await app.documents.add(options);
      } catch (error) {
        window.IDPhotoPhotoshopExecution.throwIfCancelled(error);
        firstError = error;
        console.error("[canvas] app.documents.add failed with full options", error);
        console.log("[canvas] retrying app.documents.add with minimal options", minimalOptions);
        try {
          return await app.documents.add(minimalOptions);
        } catch (minimalError) {
          window.IDPhotoPhotoshopExecution.throwIfCancelled(minimalError);
          console.error("[canvas] app.documents.add failed with minimal options", minimalError);
          if (!app.createDocument) {
            throw minimalError || firstError;
          }
        }
      }
    }

    if (typeof app.createDocument === "function") {
      try {
        return await app.createDocument(options);
      } catch (createError) {
        window.IDPhotoPhotoshopExecution.throwIfCancelled(createError);
        firstError = firstError || createError;
        console.error("[canvas] app.createDocument failed with full options", createError);
        console.log("[canvas] retrying app.createDocument with minimal options", minimalOptions);
        return await app.createDocument(minimalOptions);
      }
    }

    throw firstError || new Error("当前 Photoshop DOM 不支持 documents.add 或 createDocument");
  }

  async function createSixInchCanvas(name) {
    var photoshop = getPhotoshopModule();
    var app = photoshop.app;
    var documentName = name || TEST_DOCUMENT_NAME;
    var options = makeCreateOptions(documentName);
    var createdDocument = null;

    if (!app) {
      throw new Error("当前 Photoshop UXP API 不支持 app 对象");
    }

    console.log("[canvas] creating 3600x2400 600ppi document", options);

    await window.IDPhotoPhotoshopExecution.executeAsModal(
      async function () {
        createdDocument = await createDocumentWithDom(app, options);
      },
      "创建 6 寸空白排版画布"
    );

    console.log("[canvas] success", createdDocument);

    return {
      ok: true,
      name: documentName,
      widthCm: CANVAS_WIDTH_CM,
      heightCm: CANVAS_HEIGHT_CM,
      widthPx: CANVAS_WIDTH_PX,
      heightPx: CANVAS_HEIGHT_PX,
      resolution: CANVAS_PPI,
      document: createdDocument,
      message: "已创建 6 寸空白画布：" + documentName + "，3600x2400px，600ppi"
    };
  }

  window.IDPhotoCanvasService = {
    createSixInchCanvas: createSixInchCanvas,
    CANVAS_WIDTH_CM: CANVAS_WIDTH_CM,
    CANVAS_HEIGHT_CM: CANVAS_HEIGHT_CM,
    CANVAS_PPI: CANVAS_PPI,
    CANVAS_WIDTH_PX: CANVAS_WIDTH_PX,
    CANVAS_HEIGHT_PX: CANVAS_HEIGHT_PX,
    TEST_DOCUMENT_NAME: TEST_DOCUMENT_NAME
  };
})();

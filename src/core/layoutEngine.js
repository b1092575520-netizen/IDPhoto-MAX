(function () {
  "use strict";

  var CANVAS_WIDTH_PX = 3600;
  var CANVAS_HEIGHT_PX = 2400;

  function numberOrZero(value) {
    return Math.max(0, Number(value) || 0);
  }

  function round(value) {
    return Math.round(Number(value) || 0);
  }

  function cloneInfoBar(infoBar) {
    var cloned;
    if (!infoBar || !infoBar.enabled || infoBar.position === "none") {
      return null;
    }
    cloned = {
      kind: infoBar.kind || infoBar.position,
      position: infoBar.position,
      orientation: infoBar.orientation || (infoBar.position === "right" ? "vertical" : "horizontal"),
      x: round(infoBar.x),
      y: round(infoBar.y),
      width: round(infoBar.width),
      height: round(infoBar.height),
      source: "reference-template"
    };
    ["background", "textColor", "avatar", "texts", "layoutVersion", "pickupLayout", "safeMargin"].forEach(function (key) {
      if (infoBar[key]) {
        cloned[key] = JSON.parse(JSON.stringify(infoBar[key]));
      }
    });
    return cloned;
  }

  function cloneSlot(template, sourceSlot, index) {
    return {
      x: round(sourceSlot.x),
      y: round(sourceSlot.y),
      width: round(sourceSlot.width || template.photoWidthPx || template.widthPx),
      height: round(sourceSlot.height || template.photoHeightPx || template.heightPx),
      rotate: round(sourceSlot.rotate),
      label: sourceSlot.label || "photo_" + (index + 1),
      row: typeof sourceSlot.row === "number" ? sourceSlot.row : 0,
      col: typeof sourceSlot.col === "number" ? sourceSlot.col : index,
      source: "reference-template"
    };
  }

  function getAreaFromPositions(positions) {
    var minX = CANVAS_WIDTH_PX;
    var minY = CANVAS_HEIGHT_PX;
    var maxX = 0;
    var maxY = 0;

    positions.forEach(function (position) {
      minX = Math.min(minX, position.x);
      minY = Math.min(minY, position.y);
      maxX = Math.max(maxX, position.x + position.width);
      maxY = Math.max(maxY, position.y + position.height);
    });

    return {
      x: round(minX),
      y: round(minY),
      width: round(maxX - minX),
      height: round(maxY - minY)
    };
  }

  function getGridDebug(positions) {
    var rows = {};
    var cols = {};

    positions.forEach(function (position) {
      rows[position.row] = true;
      cols[position.col] = true;
    });

    return {
      rows: Object.keys(rows).length,
      cols: Object.keys(cols).length,
      count: positions.length
    };
  }

  function assertTemplateSlots(template) {
    if (!template.photoSlots || !template.photoSlots.length) {
      throw new Error(template.name + " 缺少参考图 photoSlots，禁止自行推导布局");
    }
  }

  function assertInsideCanvas(template, positions, infoBar) {
    positions.forEach(function (position, index) {
      if (
        position.x < 0 ||
        position.y < 0 ||
        position.x + position.width > template.canvasWidthPx ||
        position.y + position.height > template.canvasHeightPx
      ) {
        throw new Error(
          template.name +
            " 第 " +
            (index + 1) +
            " 个参考槽位越界：" +
            position.x +
            "," +
            position.y +
            "," +
            position.width +
            "," +
            position.height
        );
      }
    });

    if (
      infoBar &&
      (infoBar.x < 0 ||
        infoBar.y < 0 ||
        infoBar.x + infoBar.width > template.canvasWidthPx ||
        infoBar.y + infoBar.height > template.canvasHeightPx)
    ) {
      throw new Error(template.name + " 信息条参考区域越界");
    }
  }

  function logPlan(plan) {
    console.log("[layoutEngine] reference-template plan", {
      templateId: plan.templateId,
      templateName: plan.templateName,
      referencePath: plan.referencePath,
      layoutName: plan.layoutName,
      infoBar: plan.infoBar,
      debug: plan.debug
    });

    plan.positions.forEach(function (position, index) {
      console.log("[layoutEngine] photo slot", {
        index: index + 1,
        row: position.row,
        col: position.col,
        targetX: position.x,
        targetY: position.y,
        width: position.width,
        height: position.height,
        rotate: position.rotate
      });
    });
  }

  function makeTemplatePlan(template, rowGap, colGap) {
    var positions;
    var infoBar;
    var area;
    var grid;
    var plan;

    assertTemplateSlots(template);

    positions = template.photoSlots.map(function (sourceSlot, index) {
      return cloneSlot(template, sourceSlot, index);
    });
    infoBar = cloneInfoBar(template.infoBar);
    area = getAreaFromPositions(positions);
    grid = getGridDebug(positions);

    assertInsideCanvas(template, positions, infoBar);

    plan = {
      templateId: template.id,
      templateName: template.name,
      referencePath: template.referencePath,
      layoutName: template.layoutMode || "reference-template",
      positions: positions,
      infoBar: infoBar,
      canvas: {
        widthPx: template.canvasWidthPx || CANVAS_WIDTH_PX,
        heightPx: template.canvasHeightPx || CANVAS_HEIGHT_PX
      },
      placedCount: positions.length,
      debug: {
        templateDriven: true,
        referencePath: template.referencePath,
        referenceFile: template.referenceFile,
        referenceWidthPx: template.referenceWidthPx,
        referenceHeightPx: template.referenceHeightPx,
        canvasWidthPx: template.canvasWidthPx,
        canvasHeightPx: template.canvasHeightPx,
        photoWidthPx: template.photoWidthPx || template.widthPx,
        photoHeightPx: template.photoHeightPx || template.heightPx,
        infoBarPosition: template.infoBarPosition,
        area: area,
        rows: grid.rows,
        cols: grid.cols,
        count: grid.count,
        expectedCount: positions.length,
        rowGapFromUi: rowGap,
        colGapFromUi: colGap,
        rowGapApplied: false,
        colGapApplied: false
      }
    };

    logPlan(plan);
    return plan;
  }

  function createLayoutPlan(options) {
    var template = options.template;
    var rowGap = numberOrZero(options.rowGap);
    var colGap = numberOrZero(options.colGap);

    if (!template) {
      throw new Error("layoutEngine 缺少模板");
    }

    return makeTemplatePlan(template, rowGap, colGap);
  }

  function calculateStandardTwoInchPlan(options) {
    return createLayoutPlan(options);
  }

  function layoutRegularTemplate(template, rowGap, colGap) {
    return makeTemplatePlan(template, numberOrZero(rowGap), numberOrZero(colGap));
  }

  window.IDPhotoLayoutEngine = {
    CANVAS_WIDTH_PX: CANVAS_WIDTH_PX,
    CANVAS_HEIGHT_PX: CANVAS_HEIGHT_PX,
    createLayoutPlan: createLayoutPlan,
    calculateStandardTwoInchPlan: calculateStandardTwoInchPlan,
    layoutRegularTemplate: layoutRegularTemplate,
    layoutRightInfoBarTemplate: layoutRegularTemplate,
    layoutBottomInfoBarTemplate: layoutRegularTemplate,
    layoutNoInfoBarTemplate: layoutRegularTemplate,
    layoutUsVisa51Template: layoutRegularTemplate,
    layoutGraduationTemplate: layoutRegularTemplate,
    layoutMarriageTemplate: layoutRegularTemplate
  };
})();

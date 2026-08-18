(function () {
  "use strict";

  function unique(templateIds) {
    var result = [];
    (templateIds || []).forEach(function (templateId) {
      if (templateId && result.indexOf(templateId) < 0) {
        result.push(templateId);
      }
    });
    return result;
  }

  function toggle(selectedIds, templateId) {
    var next = unique(selectedIds);
    var index = next.indexOf(templateId);
    if (index >= 0) {
      next.splice(index, 1);
    } else if (templateId) {
      next.push(templateId);
    }
    return next;
  }

  function forDoubleClick(selectedIds, templateId) {
    var next = unique(selectedIds);
    if (templateId && next.indexOf(templateId) < 0) {
      next.push(templateId);
    }
    return next;
  }

  function isRepeatedDoubleActivation(previousAt, currentAt) {
    var elapsed = Number(currentAt) - Number(previousAt);
    return Boolean(previousAt) && Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 700;
  }

  function mergeModifiers(previous, current) {
    previous = previous || {};
    current = current || {};
    return {
      ctrlKey: Boolean(previous.ctrlKey || current.ctrlKey),
      shiftKey: Boolean(previous.shiftKey || current.shiftKey),
      metaKey: Boolean(previous.metaKey || current.metaKey),
      detail: current.detail || previous.detail || 1
    };
  }

  function clear() {
    return [];
  }

  window.IDPhotoTemplateSelectionService = {
    toggle: toggle,
    forDoubleClick: forDoubleClick,
    isRepeatedDoubleActivation: isRepeatedDoubleActivation,
    mergeModifiers: mergeModifiers,
    clear: clear
  };
})();

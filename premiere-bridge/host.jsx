/* Documented Premiere ExtendScript APIs; no QE or keyboard automation. */
{
  $._quickCaptionBridge = (function () {
    var completed = $._quickCaptionCompleted || ($._quickCaptionCompleted = {});
    function fail(message, code) { var error = new Error(message); error.code = code; throw error; }
    function json(action, input) {
      try { return JSON.stringify(action(JSON.parse(input))); }
      catch (error) { return JSON.stringify({ ok: false, error: error.message, code: error.code || 'host_error' }); }
    }
    function guid(value) { return String(value).replace(/[{}]/g, '').toLowerCase(); }
    function pathname(value) {
      var path = String(value).replace(/\\/g, '/');
      // UXP returns Windows extended-length paths; ExtendScript returns ordinary paths.
      if (Folder.fs === 'Windows') path = path.replace(/^\/\/\?\/UNC\//i, '//').replace(/^\/\/\?\//, '');
      var result = new File(path).fsName.replace(/\\/g, '/');
      return Folder.fs === 'Windows' ? result.toLowerCase() : result;
    }
    function resolveTarget(target) {
      if (!target || !app.project || pathname(app.project.path) !== pathname(target.projectPath)) fail('חזרו לפרויקט המקורי כדי להציב את הכתוביות', 'wrong_project');
      var sequence = null;
      for (var i = 0; i < app.project.sequences.numSequences; i++) {
        var candidate = app.project.sequences[i];
        if (guid(candidate.sequenceID) === guid(target.sequenceId)) { sequence = candidate; break; }
      }
      if (!sequence) fail('הסיקוונס המקורי אינו זמין', 'missing_sequence');
      if (typeof sequence.createCaptionTrack !== 'function') fail('גרסת פרימייר אינה תומכת בהצבת כתוביות', 'unsupported_host');
      for (var c = 0; c < target.clips.length; c++) {
        var expected = target.clips[c];
        var tracks = expected.kind === 'Audio' ? sequence.audioTracks : sequence.videoTracks;
        var matched = false;
        if (expected.track < tracks.numTracks) {
          var clips = tracks[expected.track].clips;
          for (var n = 0; n < clips.numItems; n++) {
            var clip = clips[n];
            if (String(clip.start.ticks) === expected.startTicks && String(clip.end.ticks) === expected.endTicks &&
                String(clip.inPoint.ticks) === expected.inTicks && String(clip.outPoint.ticks) === expected.outTicks &&
                clip.projectItem && pathname(clip.projectItem.getMediaPath()) === pathname(expected.sourcePath) &&
                Math.abs(clip.getSpeed() - expected.speed) < 0.000001 && !!clip.isSpeedReversed() === expected.reversed && !!clip.disabled === expected.disabled) { matched = true; break; }
          }
        }
        if (!matched) fail('אחד הקטעים השתנה. הכתוביות נשמרו; לא בוצע תמלול נוסף', 'changed_clip');
      }
      return sequence;
    }
    function findImported(folder, sourcePath) {
      for (var i = 0; i < folder.children.numItems; i++) {
        var item = folder.children[i];
        if (item.type === ProjectItemType.BIN) { var nested = findImported(item, sourcePath); if (nested) return nested; }
        else { try { var mediaPath = item.getMediaPath(); if (mediaPath && pathname(mediaPath) === pathname(sourcePath)) return item; } catch (ignored) { /* Non-media project item. */ } }
      }
      return null;
    }
    function sequenceInfo(sequence) {
      return { ok: true, frameTicks: String(sequence.timebase), width: Number(sequence.frameSizeHorizontal), height: Number(sequence.frameSizeVertical), sequenceId: String(sequence.sequenceID), projectPath: app.project.path };
    }
    function ownedFile(value, extension) {
      var root = pathname(Folder.userData.fsName + '/Quick Caption/Premiere Bridge QA') + '/';
      var actual = pathname(value || '');
      if (actual.indexOf(root) !== 0 || actual.substr(actual.length - extension.length) !== extension) fail('נתיב הגרפיקה אינו שייך לתוסף', 'invalid_graphics');
      return new File(value);
    }
    function emptySequence(original, sourcePath, bin) {
      var known = {}, result = null;
      for (var i = 0; i < app.project.sequences.numSequences; i++) known[guid(app.project.sequences[i].sequenceID)] = true;
      if (!app.project.importFiles([ownedFile(sourcePath, '.xml').fsName], true, bin, false)) fail('ייבוא הסיקוונס הפנימי נכשל', 'graphics_import_failed');
      for (i = 0; i < app.project.sequences.numSequences; i++) {
        var candidate = app.project.sequences[i];
        if (!known[guid(candidate.sequenceID)]) { if (result) fail('ייבוא סיקוונס אינו חד משמעי', 'graphics_import_failed'); result = candidate; }
      }
      if (!result) fail('הסיקוונס הפנימי לא נוצר', 'graphics_import_failed');
      if (!result.videoTracks.numTracks) fail('לא נוצר ערוץ גרפיקה', 'graphics_import_failed');
      result.setSettings(original.getSettings());
      result.projectItem.moveBin(bin);
      app.project.openSequence(result.sequenceID);
      return result;
    }
    function frameTime(frame, ticks) { var value = new Time(); value.ticks = String(frame * Number(ticks)); return value; }
    function graphic(sequence, state, frameTicks, bin, label) {
      var asset = ownedFile(state.assetPath, '.mogrt');
      if (!asset.exists) fail('קובץ הגרפיקה חסר', 'missing_graphics');
      var clip = sequence.importMGT(asset.fsName.replace(/\\/g, '/'), frameTime(state.startFrame, frameTicks).ticks, 0, 0);
      if (!clip || !clip.components || !clip.components.numItems) fail('ייבוא הטקסט נכשל', 'graphics_import_failed');
      // Native Premiere graphics are timeline objects without a ProjectItem.
      if (clip.projectItem) clip.projectItem.moveBin(bin);
      clip.inPoint = frameTime(0, frameTicks);
      clip.outPoint = frameTime(state.endFrame - state.startFrame, frameTicks);
      clip.end = frameTime(state.endFrame, frameTicks);
      clip.name = label;
      if (String(clip.start.ticks) !== frameTime(state.startFrame, frameTicks).ticks || String(clip.end.ticks) !== frameTime(state.endFrame, frameTicks).ticks) fail('פרימייר לא אישר את תזמון המילה', 'graphics_timing_failed');
      return clip;
    }
    function inspectNativeGraphics(data) {
      var original = app.project && app.project.activeSequence;
      if (!original) fail('פתחו סיקוונס לפני בדיקת הגרפיקה', 'missing_sequence');
      var scratch = null, probeNested = null, bin = app.project.rootItem.createBin('Quick Caption compatibility check');
      try {
        scratch = emptySequence(original, data.scaffoldPath, bin);
        var clip = graphic(scratch, { assetPath: data.assetPath, startFrame: 0, endFrame: 50 }, String(original.timebase), bin, 'Quick Caption compatibility check');
        var components = [];
        for (var i = 0; i < clip.components.numItems; i++) {
          var component = clip.components[i], properties = [];
          for (var p = 0; p < component.properties.numItems; p++) {
            var prop = component.properties[p], value = null;
            try { value = prop.getValue(); } catch (ignored) {}
            if (typeof value === 'string' && value.length > 16000) value = value.substr(0, 16000);
            properties.push({ name: prop.displayName, value: value });
          }
          components.push({ name: component.displayName, matchName: component.matchName, properties: properties });
        }
        var projectOutput = ownedFile(data.projectOutput, '.prproj');
        scratch.exportAsProject(projectOutput.fsName);
        var imageOutput = ownedFile(data.imageOutput, '.png');
        // Adobe's installed PNG preset; only this probe renders, never production delivery.
        var pngPreset = new File(Folder.startup.fsName + '/MediaIO/systempresets/3F3F3F3F_504E4720/PNG Sequence with Alpha (Match Source).epr');
        if (!pngPreset.exists) pngPreset = new File('C:/Program Files/Adobe/Adobe Media Encoder 2026/MediaIO/systempresets/3F3F3F3F_504E4720/PNG Sequence with Alpha (Match Source).epr');
        var rendered = false;
        if (data.render !== false && pngPreset.exists) { scratch.setInPoint(0); scratch.setOutPoint(Number(original.timebase) / 254016000000); rendered = scratch.exportAsMediaDirect(imageOutput.fsName, pngPreset.fsName, 1); }
        clip.outPoint = frameTime(25, String(original.timebase)); clip.end = frameTime(25, String(original.timebase));
        graphic(scratch, {assetPath:data.assetPath,startFrame:25,endFrame:50},String(original.timebase),bin,'Second word state');
        scratch.setInPoint(0);scratch.setOutPoint(frameTime(50,String(original.timebase)).seconds);
        probeNested=scratch.createSubsequence(true);
        if(!probeNested || probeNested.sequenceID===original.sequenceID || probeNested.videoTracks[0].clips.numItems!==2)fail('יצירת ציר זמן פנימי נכשלה','unsupported_graphics');
        return { ok: true, compatible: true, nestedStateCount:probeNested.videoTracks[0].clips.numItems, hostVersion: app.version, components: components, projectOutput: projectOutput.fsName, rendered: rendered, frameTicks: String(original.timebase), width: Number(original.frameSizeHorizontal), height: Number(original.frameSizeVertical) };
      } finally {
        if (probeNested && probeNested.sequenceID !== original.sequenceID) app.project.deleteSequence(probeNested);
        if (scratch) app.project.deleteSequence(scratch);
        if (bin) bin.deleteBin();
        app.project.openSequence(original.sequenceID);
      }
    }
    function buildGraphics(data) {
      var key = 'graphics:' + data.id;
      if (completed[key]) return completed[key];
      var original = resolveTarget(data.target), plan = data.plan;
      if (!plan || plan.version !== 1 || plan.frameTicks !== String(original.timebase) || !plan.phrases || !plan.phrases.length) fail('מבנה גרפיקה לא תקין', 'invalid_graphics');
      var bin = app.project.rootItem.createBin('Quick Caption · active words · ' + data.id), scratch = null, nested = [], failed = true;
      try {
        scratch = emptySequence(original, data.scaffoldPath, bin);
        for (var p = 0; p < plan.phrases.length; p++) {
          var phrase = plan.phrases[p];
          for (var c = scratch.videoTracks[0].clips.numItems - 1; c >= 0; c--) scratch.videoTracks[0].clips[c].remove(false, false);
          for (var s = 0; s < phrase.states.length; s++) {
            var state = phrase.states[s];
            graphic(scratch, state, plan.frameTicks, bin, state.word ? 'הדגשה: ' + state.word : 'ללא הדגשה');
          }
          scratch.setInPoint(0);
          scratch.setOutPoint(frameTime(phrase.endFrame - phrase.startFrame, plan.frameTicks).seconds);
          var sequence = scratch.createSubsequence(true);
          if (!sequence || sequence.sequenceID === original.sequenceID) fail('יצירת ציר הזמן הפנימי נכשלה', 'graphics_import_failed');
          nested.push({ sequenceId: String(sequence.sequenceID), startFrame: phrase.startFrame, endFrame: phrase.endFrame, stateCount: phrase.states.length });
          sequence.name = 'QC ' + (p + 1) + ' · ' + phrase.text.substr(0, 70);
          sequence.projectItem.moveBin(bin);
          sequence.projectItem.setInPoint(0, 1);
          sequence.projectItem.setOutPoint(frameTime(phrase.endFrame - phrase.startFrame, plan.frameTicks).seconds, 1);
          if (sequence.videoTracks[0].clips.numItems !== phrase.states.length) fail('לא כל ההדגשות נכנסו לסיקוונס', 'graphics_import_failed');
        }
        resolveTarget(data.target);
        var result = { ok: true, frameTicks: plan.frameTicks, phrases: nested, binId: String(bin.nodeId) };
        completed[key] = result; failed = false; return result;
      } finally {
        if (scratch) app.project.deleteSequence(scratch);
        if (failed) {
          for (var n = 0; n < nested.length; n++) for (var i = app.project.sequences.numSequences - 1; i >= 0; i--) if (String(app.project.sequences[i].sequenceID) === nested[n].sequenceId) app.project.deleteSequence(app.project.sequences[i]);
          if (bin) bin.deleteBin();
        }
        app.project.openSequence(original.sequenceID);
      }
    }
    return {
      graphicsInfo: function (input) { return json(function () { if (!app.project || !app.project.activeSequence) fail('פתחו סיקוונס לפני בדיקת הגרפיקה', 'missing_sequence'); return sequenceInfo(app.project.activeSequence); }, input); },
      inspectNativeGraphics: function (input) { return json(inspectNativeGraphics, input); },
      buildGraphics: function (input) { return json(buildGraphics, input); },
      lookupGraphics: function (input) { return json(function (data) { return { ok: true, result: completed['graphics:' + data.id] || null }; }, input); },
      health: function (input) { return json(function () { return { ok: true, protocolVersion: 1, version: '1.1.0', nativeGraphics: true, hostVersion: app.version }; }, input); },
      prepare: function (input) { return json(function (data) { return sequenceInfo(resolveTarget(data.target)); }, input); },
      lookup: function (input) { return json(function (data) { return { ok: true, result: completed['delivery:' + data.id] || null }; }, input); },
      deliver: function (input) { return json(function (data) {
        if (completed['delivery:' + data.id]) return completed['delivery:' + data.id];
        var sequence = resolveTarget(data.target);
        var source = findImported(app.project.rootItem, data.srtPath);
        if (!source) {
          if (!app.project.importFiles([data.srtPath], true, app.project.getInsertionBin(), false)) fail('פרימייר לא הצליח לייבא את הכתוביות', 'import_failed');
          source = findImported(app.project.rootItem, data.srtPath);
        }
        if (!source) fail('לא ניתן לזהות את קובץ הכתוביות שיובא', 'missing_import');
        // SRT already contains absolute sequence-relative times, including original gaps.
        // Revalidate immediately before mutation; never use whichever sequence is active.
        sequence = resolveTarget(data.target);
        if (!sequence.createCaptionTrack(source, 0)) fail('לא ניתן לאשר שהצבת הכתוביות הושלמה', 'delivery_uncertain');
        var result = { ok: true, sequenceId: String(sequence.sequenceID), sourcePath: data.srtPath, projectItemId: String(source.nodeId) };
        completed['delivery:' + data.id] = result;
        return result;
      }, input); },
    };
  }());
}

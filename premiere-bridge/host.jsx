/* Only documented Premiere ExtendScript APIs; no QE or keyboard automation. */
if (!$._quickCaptionBridge) {
  $._quickCaptionBridge = (function () {
    var completed = {};
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
    return {
      health: function (input) { return json(function () { return { ok: true, protocolVersion: 1, version: '1.0.0', hostVersion: app.version }; }, input); },
      prepare: function (input) { return json(function (data) { var sequence = resolveTarget(data.target); return { ok: true, sequenceId: String(sequence.sequenceID) }; }, input); },
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

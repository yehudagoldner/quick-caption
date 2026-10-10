/* Documented Premiere ExtendScript APIs; no QE or keyboard automation. */
{
  $._quickCaptionBridge = (function () {
    var completed = $._quickCaptionCompleted || ($._quickCaptionCompleted = {});
    function fail(message, code) { var error = new Error(message); error.code = code; throw error; }
    function json(action, input) {
      try { return JSON.stringify(action(JSON.parse(input))); }
      catch (error) { return JSON.stringify({ ok: false, error: error.message, code: error.code || 'host_error', line: Number(error.line) || undefined }); }
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
    function referenceAudio(target, bin) {
      var data = target.referenceAudio;
      if (!data) return null; // Existing saved deliveries retain their original format.
      var root = pathname(Folder.userData.fsName + '/Adobe/UXP/PluginsStorage/PPRO') + '/';
      var actual = pathname(data.sourcePath || ''), suffix = actual.substr(root.length);
      // Accept our development and release IDs, including dotted host-version
      // folders. Keep the user-data root and exact owned WAV directory boundary.
      if (actual.indexOf(root) !== 0 || !/^\d+(?:\.\d+)*\/(Developer|External)\/com\.quickcaption\.premiere(?:\.qa)?\/PluginData\/reference-audio\/selection-[a-zA-Z0-9%:_-]+\.wav$/i.test(suffix)) fail('נתיב האודיו לעריכה אינו שייך לתוסף', 'invalid_reference_audio');
      var file = new File(data.sourcePath), cursor = 0, previous = -1;
      if (!file.exists || !data.ranges || !data.ranges.length || !isFinite(data.durationSeconds) || data.durationSeconds <= 0) fail('האודיו לעריכה חסר. התמלול נשמר', 'missing_reference_audio');
      for (var i = 0; i < data.ranges.length; i++) {
        var range = data.ranges[i];
        if (!isFinite(range.start) || !isFinite(range.end) || !isFinite(range.outputStart) || range.start < previous || range.start < 0 || range.end <= range.start || Math.abs(range.outputStart - cursor) > 0.000001) fail('מפת האודיו לעריכה אינה תקינה', 'invalid_reference_audio');
        cursor += range.end - range.start; previous = range.end;
      }
      if (Math.abs(cursor - data.durationSeconds) > 0.000001) fail('משך האודיו לעריכה אינו תואם לבחירה', 'invalid_reference_audio');
      var source = findImported(app.project.rootItem, file.fsName);
      if (!source) {
        if (!app.project.importFiles([file.fsName], true, bin, false)) fail('ייבוא האודיו לעריכה נכשל', 'reference_audio_import_failed');
        source = findImported(app.project.rootItem, file.fsName);
      }
      if (!source) fail('לא ניתן לזהות את האודיו לעריכה', 'reference_audio_import_failed');
      return { source: source, ranges: data.ranges };
    }
    function addReferenceAudio(sequence, phrase, frameTicks, reference) {
      if (!reference) return 0;
      var fpsSeconds = Number(frameTicks) / 254016000000;
      var start = phrase.startFrame * fpsSeconds, end = phrase.endFrame * fpsSeconds, range = null;
      for (var i = 0; i < reference.ranges.length; i++) {
        var candidate = reference.ranges[i];
        if (start >= candidate.start - fpsSeconds / 2 - 0.000001 && end <= candidate.end + fpsSeconds / 2 + 0.000001) { range = candidate; break; }
      }
      if (!range) fail('המשפט אינו תואם למפת האודיו', 'invalid_reference_audio');
      var from = Math.max(start, range.start), to = Math.min(end, range.end);
      if (to <= from || !sequence.audioTracks.numTracks) fail('אין אודיו מתאים למשפט', 'invalid_reference_audio');
      var input = range.outputStart + from - range.start, output = range.outputStart + to - range.start;
      reference.source.setInPoint(input, 2); reference.source.setOutPoint(output, 2);
      sequence.audioTracks[0].overwriteClip(reference.source, from - start);
      if (sequence.audioTracks[0].clips.numItems !== 1) fail('הצבת האודיו לעריכה נכשלה', 'reference_audio_import_failed');
      var clip = sequence.audioTracks[0].clips[0];
      // Import uses frame-rounded ProjectItem bounds (and can lose the final
      // frame). Set sample-time clip bounds explicitly after the overwrite.
      var inTime = new Time(), outTime = new Time(), startTime = new Time(), endTime = new Time();
      inTime.seconds = input; outTime.seconds = output; startTime.seconds = from - start; endTime.seconds = to - start;
      clip.inPoint = inTime; clip.outPoint = outTime; clip.start = startTime; clip.end = endTime;
      clip.name = 'אודיו למשפט';
      if (Math.abs(clip.inPoint.seconds - input) > 1 / 1000 || Math.abs(clip.outPoint.seconds - output) > 1 / 1000 || Math.abs(clip.start.seconds - (from - start)) > 1 / 1000 || Math.abs(clip.end.seconds - (to - start)) > 1 / 1000) fail('תזמון האודיו לעריכה אינו תואם', 'reference_audio_timing_failed');
      return 1;
    }
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
      var bin = app.project.rootItem.createBin('Quick Caption · active words · ' + data.id), scratch = null, nested = [], failed = true, reference = null;
      try {
        reference = referenceAudio(data.target, bin);
        scratch = emptySequence(original, data.scaffoldPath, bin);
        for (var p = 0; p < plan.phrases.length; p++) {
          var phrase = plan.phrases[p];
          for (var c = scratch.videoTracks[0].clips.numItems - 1; c >= 0; c--) scratch.videoTracks[0].clips[c].remove(false, false);
          for (var a = 0; a < scratch.audioTracks.numTracks; a++) for (var ac = scratch.audioTracks[a].clips.numItems - 1; ac >= 0; ac--) scratch.audioTracks[a].clips[ac].remove(false, false);
          var audioCount = addReferenceAudio(scratch, phrase, plan.frameTicks, reference);
          for (var s = 0; s < phrase.states.length; s++) {
            var state = phrase.states[s];
            graphic(scratch, state, plan.frameTicks, bin, state.word ? 'הדגשה: ' + state.word : 'ללא הדגשה');
          }
          scratch.setInPoint(0);
          scratch.setOutPoint(frameTime(phrase.endFrame - phrase.startFrame, plan.frameTicks).seconds);
          var sequence = scratch.createSubsequence(true);
          if (!sequence || sequence.sequenceID === original.sequenceID) fail('יצירת ציר הזמן הפנימי נכשלה', 'graphics_import_failed');
          nested.push({ sequenceId: String(sequence.sequenceID), startFrame: phrase.startFrame, endFrame: phrase.endFrame, stateCount: phrase.states.length, referenceAudio: !!reference });
          sequence.name = 'QC ' + (p + 1) + ' · ' + phrase.text.substr(0, 70);
          sequence.projectItem.moveBin(bin);
          sequence.projectItem.setInPoint(0, 1);
          sequence.projectItem.setOutPoint(frameTime(phrase.endFrame - phrase.startFrame, plan.frameTicks).ticks, 1);
          if (sequence.videoTracks[0].clips.numItems !== phrase.states.length) fail('לא כל ההדגשות נכנסו לסיקוונס', 'graphics_import_failed');
          if (audioCount && (!sequence.audioTracks.numTracks || sequence.audioTracks[0].clips.numItems !== audioCount)) fail('האודיו לא נכנס לציר הזמן הפנימי', 'reference_audio_import_failed');
        }
        resolveTarget(data.target);
        var result = { ok: true, frameTicks: plan.frameTicks, phrases: nested, binId: String(bin.nodeId), binName: 'Quick Caption · active words · ' + data.id, referenceAudio: !!reference };
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
    function attachReferenceAudio(target) {
      var original = resolveTarget(target), delivery = target.graphicsDelivery, built = delivery && delivery.built;
      if (!built || !built.phrases || !built.phrases.length || built.frameTicks !== String(original.timebase) || !/^[a-zA-Z0-9:_-]{1,160}$/.test(target.id || '') || !target.referenceAudio) fail('נתוני הכתוביות הקיימות אינם תקינים', 'invalid_reference_audio');
      var root = app.project.rootItem, bin = null, binCount = 0, records = [];
      for (var b = 0; b < root.children.numItems; b++) {
        var item = root.children[b];
        if (item.type === ProjectItemType.BIN && ((built.binName && item.name === built.binName) || (!built.binName && String(item.nodeId) === String(built.binId)))) { bin = item; binCount++; }
      }
      if (binCount !== 1) fail('תיקיית הכתוביות הקיימות השתנתה', 'changed_graphics');
      var referencePath = pathname(target.referenceAudio.sourcePath);
      for (var p = 0; p < built.phrases.length; p++) {
        var phrase = built.phrases[p], sequence = null;
        for (var s = 0; s < app.project.sequences.numSequences; s++) if (guid(app.project.sequences[s].sequenceID) === guid(phrase.sequenceId)) sequence = app.project.sequences[s];
        if (!sequence || sequence.sequenceID === original.sequenceID) fail('ציר הזמן הפנימי של הכתוביות חסר', 'changed_graphics');
        var member = false;
        for (var c = 0; c < bin.children.numItems; c++) if (String(bin.children[c].nodeId) === String(sequence.projectItem.nodeId)) member = true;
        if (!member) fail('ציר הזמן אינו שייך לכתוביות של התמלול הזה', 'changed_graphics');
        var matches = 0, expectedStart = frameTime(phrase.startFrame, built.frameTicks), expectedEnd = frameTime(phrase.endFrame, built.frameTicks);
        for (var v = 0; v < original.videoTracks.numTracks; v++) for (var vc = 0; vc < original.videoTracks[v].clips.numItems; vc++) {
          var placed = original.videoTracks[v].clips[vc];
          if (placed.projectItem && String(placed.projectItem.nodeId) === String(sequence.projectItem.nodeId)) {
            matches++;
            // Preserve existing tail trims; moved or duplicate captions are unsafe.
            if (v !== delivery.videoIndex || String(placed.start.ticks) !== expectedStart.ticks || placed.end.seconds <= placed.start.seconds || placed.end.seconds > expectedEnd.seconds + 0.000001) fail('מיקום הכתוביות השתנה. ההדגשות נשמרו', 'changed_graphics');
          }
        }
        if (matches !== 1) fail('לא ניתן לזהות את הכתוביות בציר הזמן המקורי', 'changed_graphics');
        // Filling an empty nest would also make any retained nested audio in the
        // master audible. Refuse that case before touching any reference audio.
        for (var ma = 0; ma < original.audioTracks.numTracks; ma++) for (var mc = 0; mc < original.audioTracks[ma].clips.numItems; mc++) {
          var masterAudio = original.audioTracks[ma].clips[mc];
          if (masterAudio.projectItem && String(masterAudio.projectItem.nodeId) === String(sequence.projectItem.nodeId)) fail('נמצא אודיו של הכתוביות בציר הזמן הראשי. השלימו את ההצבה לפני הוספת סאונד לעריכה', 'changed_graphics');
        }
        var count = 0;
        for (var a = 0; a < sequence.audioTracks.numTracks; a++) for (var ac = 0; ac < sequence.audioTracks[a].clips.numItems; ac++) {
          var existing = sequence.audioTracks[a].clips[ac]; count++;
          if (a !== 0 || count > 1 || existing.name !== 'אודיו למשפט' || !existing.projectItem || pathname(existing.projectItem.getMediaPath()) !== referencePath) fail('יש אודיו נוסף במשפט. לא הוחלף אודיו קיים', 'changed_graphics');
        }
        records.push({sequence:sequence,phrase:phrase});
      }
      var reference = referenceAudio(target, bin);
      for (var n = 0; n < records.length; n++) {
        var record = records[n];
        resolveTarget(target);
        // Never replace an existing track item. A retry fills only empty nests,
        // retaining audio already added by this operation, including user trims.
        if (!record.sequence.audioTracks.numTracks || !record.sequence.audioTracks[0].clips.numItems) addReferenceAudio(record.sequence, record.phrase, built.frameTicks, reference);
      }
      resolveTarget(target);
      var updated = JSON.parse(JSON.stringify(delivery));
      updated.status = 'delivered'; updated.cueCount = records.length; updated.trackLabel = 'V' + (delivery.videoIndex + 1);
      updated.built.referenceAudio = true;
      for (var q = 0; q < updated.built.phrases.length; q++) updated.built.phrases[q].referenceAudio = true;
      return {ok:true,delivery:updated};
    }
    return {
      graphicsInfo: function (input) { return json(function () { if (!app.project || !app.project.activeSequence) fail('פתחו סיקוונס לפני בדיקת הגרפיקה', 'missing_sequence'); return sequenceInfo(app.project.activeSequence); }, input); },
      inspectNativeGraphics: function (input) { return json(inspectNativeGraphics, input); },
      buildGraphics: function (input) { return json(buildGraphics, input); },
      lookupGraphics: function (input) { return json(function (data) { return { ok: true, result: completed['graphics:' + data.id] || null }; }, input); },
      health: function (input) { return json(function () { return { ok: true, protocolVersion: 1, version: '1.2.0', nativeGraphics: true, referenceAudio: true, hostVersion: app.version }; }, input); },
      prepare: function (input) { return json(function (data) {
        if (data.target && data.target.operation === 'attach-reference-audio') return attachReferenceAudio(data.target);
        if (data.target && data.target.operation) fail('פעולת הכנה לא מוכרת', 'invalid_request');
        return sequenceInfo(resolveTarget(data.target));
      }, input); },
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

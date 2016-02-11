/* Copyright (c) William Toohey <will@mon.im>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
 
(function(window, document) {
"use strict";

let WAVE_PIXELS_PER_SECOND = 100;
let WAVE_HEIGHT_PIXELS = 20;

function HuesEditor(core) {
    this.buildEditSize = 80; // pixels, including header
    this.buildEdit = null;
    this.loopEdit = null;
    this.editArea = null;
    this.wrapAt = 32;
    
    this.hilightWidth = 0;
    this.hilightHeight = 0;
    
    this.undoBuffer = [];
    this.redoBuffer = [];
    // Will be an array if many actions are performed in one undo
    this.batchUndoArray = null;
    
    // For rendering the waveform
    this.buildWave = null;
    this.loopWave = null;
    this.buildWaveBuff = null;
    this.loopWaveBuff = null;
    this.waveContext = null;
    this.waveCanvas = null;
    
    // for storing respacks created with "new"
    this.respack = null;
    // when we're actually following the playing song
    this.linked = false;
    
    this.core = core;
    this.root = document.getElementById("huesEditor");
    if(!this.root) {
        return;
    }
    if(!core.settings.defaults.noUI) {
        this.initUI();
        core.addEventListener("beat", this.onBeat.bind(this));
        core.addEventListener("newsong", this.onNewSong.bind(this));
    }
}

HuesEditor.prototype.initUI = function() {
    let titleButtons = document.createElement("div");
    titleButtons.id = "edit-titlebuttons";
    this.root.appendChild(titleButtons);
    this.saveBtn = this.createButton("Save XML", titleButtons, true);
    this.saveBtn.addEventListener("click", this.saveXML.bind(this));
    this.copyBtn = this.createButton("Copy XML", titleButtons, true);
    this.copyBtn.addEventListener("click", this.copyXML.bind(this));
    this.undoBtn = this.createButton("Undo", titleButtons, true);
    this.undoBtn.addEventListener("click", this.undo.bind(this));
    this.redoBtn = this.createButton("Redo", titleButtons, true);
    this.redoBtn.addEventListener("click", this.redo.bind(this));
    let help = this.createButton("Help?", titleButtons);
    help.style.backgroundColor = "rgba(0,160,0,0.3)";
    help.addEventListener("click", () => {
        window.open("https://github.com/mon/0x40-web/tree/master/docs/Editor.md", '_blank');
    });
    
    this.statusMsg = document.createElement("span");
    this.statusMsg.id = "edit-status-msg";
    titleButtons.appendChild(this.statusMsg);
    
    this.topBar = document.createElement("div");
    this.topBar.id = "edit-topbar";
    this.root.appendChild(this.topBar);
    
    this.uiCreateInfo();
    this.uiCreateImport();
    this.root.appendChild(document.createElement("hr"));
    this.uiCreateEditArea();
    this.uiCreateControls();
    this.uiCreateVisualiser();
    
    window.addEventListener('resize', this.resize.bind(this));
    // Fix Chrome rendering - redraw on tab load
    document.getElementById("tab-editor").addEventListener("change", this.resize.bind(this));
    this.resize();
};

HuesEditor.prototype.resize = function(noHilightCalc) {
    this.root.style.height = (window.innerHeight - 200) + "px";
    let boxHeight = this.editArea.offsetHeight;
    let bHeadHeight = this.buildEdit._header.offsetHeight;
    let lHeadHeight = this.loopEdit._header.offsetHeight;
    let handleHeight = this.resizeHandle.offsetHeight;
    let minHeight = bHeadHeight;
    let maxHeight = boxHeight - handleHeight - lHeadHeight - bHeadHeight;
    let buildHeight = Math.min(maxHeight, Math.max(minHeight, this.buildEditSize - handleHeight));
    this.buildEdit.style.height = buildHeight + "px";
    this.buildEdit._box.style.height = (buildHeight - bHeadHeight) + "px";
    let loopHeight = maxHeight - buildHeight + lHeadHeight;
    this.loopEdit.style.height = loopHeight + "px";
    this.loopEdit._box.style.height = (loopHeight - lHeadHeight) + "px";
    
    // For window resizing down situation
    if(this.editArea.offsetHeight != boxHeight) {
        this.resize();
    }
    
    // Resize the time lock
    this.timeLock.style.height = (buildHeight + handleHeight) + "px";
    
    // Save to fix Chrome rendering and to enable right click to seek
    // We only resize on a window resize event, not when dragging the handle
    if(!noHilightCalc) {
        let hilight = document.createElement("div");
        hilight.className = "beat-hilight";
        // Because clientWidth is rounded, we need to take the average. 100 is plenty.
        let grid = "";
        // height goes to 99 because we always have 1 line
        for(let i = 0; i < 99; i++) {
            grid += "<br />";
        }
        // width
        for(let i = 0; i < 100; i++) {
            grid += "&nbsp;";
        }
        hilight.innerHTML = grid;
        this.loopEdit.appendChild(hilight);
        this.hilightWidth = hilight.clientWidth / 100;
        this.hilightHeight = hilight.clientHeight / 100;
        this.loopEdit.removeChild(hilight);
        
        this.waveCanvas.width = this.waveCanvas.clientWidth;
    }
};

HuesEditor.prototype.getOther = function(editor) {
    return editor == this.loopEdit ? this.buildEdit : this.loopEdit;
};

HuesEditor.prototype.onNewSong = function(song) {
    if(this.linked) {
        if(song == this.song) {
            // Because you can "edit current" before it loads
            this.updateInfo();
            this.updateWaveform();
        } else {
            this.linked = false;
            // Clear beat hilight
            this.buildEdit._hilight.innerHTML = "&block;";
            this.loopEdit._hilight.innerHTML = "&block;";
            this.buildEdit._hilight.className = "beat-hilight hidden";
            this.loopEdit._hilight.className = "beat-hilight hidden";
            // Clear waveform
            this.buildWave = null;
            this.loopWave = null;
        }
    }
};

HuesEditor.prototype.onBeat = function(map, index) {
    if(!this.song || this.core.currentSong != this.song) {
        return;
    }
    let editor;
    if(index < 0) {
        index += this.core.currentSong.buildupRhythm.length;
        editor = this.buildEdit;
        this.loopEdit._hilight.className = "beat-hilight hidden";
    } else {
        editor = this.loopEdit;
        if(this.song.buildup) {
            this.buildEdit._hilight.className = "beat-hilight hidden";
        }
    }
    editor._hilight.className = "beat-hilight";
    let offsetX = index % this.wrapAt;
    let offsetY = Math.floor(index / this.wrapAt);
    // Not computing width/height here due to Chrome bug
    editor._hilight.style.left = Math.floor(offsetX * this.hilightWidth) + "px";
    editor._hilight.style.top = Math.floor(offsetY * this.hilightHeight) + "px";
};

HuesEditor.prototype.reflow = function(editor, map) {
    if(!map) { // NOTHING TO SEE HERE
        editor._beatmap.textContent = "";
        editor._hilight.textContent = "[none]";
        editor._hilight.className = "beat-hilight";
        editor._hilight.style.top = "0";
        editor._hilight.style.left = "0";
        editor._beatCount.textContent = "0 beats";
        return;
    } else {
        editor._hilight.innerHTML = "&block;";
    }
    editor._beatCount.textContent = map.length + " beats";
    // http://stackoverflow.com/a/27012001
    // if it's too long to wrap, scroll in the x direction
    let regex = new RegExp("(.{" + this.wrapAt + "})", "g");
    editor._beatmap.innerHTML = map.replace(regex, "$1<br />");
};

HuesEditor.prototype.updateInfo = function() {
    // Avoid a bunch of nested elses
    this.seekStart.classList.add("disabled");
    this.seekLoop.classList.add("disabled");
    this.saveBtn.classList.add("disabled");
    this.copyBtn.classList.add("disabled");
    this.buildEdit._removeBtn.classList.add("disabled");
    this.loopEdit._removeBtn.classList.add("disabled");
    
    if(this.song) {
        this.saveBtn.classList.remove("disabled");
        this.copyBtn.classList.remove("disabled");
        
        if(this.song.independentBuild) {
            this.timeLock._locker.innerHTML = "&#xe904;";
            this.timeLock.classList.add("unlocked");
        } else {
            this.timeLock._locker.innerHTML = "&#xe905;";
            this.timeLock.classList.remove("unlocked");
        }
        if(this.song.sound) {
            this.seekLoop.classList.remove("disabled");
            this.loopEdit._removeBtn.classList.remove("disabled");
        }
        if(this.song.buildup) {
            this.seekStart.classList.remove("disabled");
            this.buildEdit._removeBtn.classList.remove("disabled");
        }
    }
    
    if(!this.linked) {
        return;
    }
    
    let loopLen = this.core.soundManager.loopLength;
    let buildLen = this.core.soundManager.buildLength;
    let beatLen = (loopLen / this.song.rhythm.length) * 1000;
    
    this.loopLen.textContent = loopLen.toFixed(2);
    this.buildLen.textContent = buildLen.toFixed(2);
    this.beatLen.textContent = beatLen.toFixed(2);
};

HuesEditor.prototype.loadAudio = function(editor) {
    if(editor._fileInput.files.length < 1) {
        return;
    }
    // If first load, this makes fresh, gets the core synced up
    this.newSong(this.song);
    
    // Have we just added a build to a song with a rhythm, or vice versa?
    // If so, link their lengths
    let newlyLinked = !this.song[editor._sound] && !!this.song[this.getOther(editor)._sound];
    
    // Disable load button TODO
    let file = editor._fileInput.files[0];
    
    // load audio
    this.blobToArrayBuffer(file)
    .then(buffer => {
        this.song[editor._sound] = buffer;
        // Save filename for XML export
        let noExt = file.name.replace(/\.[^/.]+$/, "");
        if(editor._sound == "sound") {
            this.song.name = noExt;
        } else {
            this.song.buildupName = noExt;
        }
        // make empty map if needed
        if(!this.getText(editor)) {
            this.setText(editor, "x...o...x...o...");
        }
        // Do we have a loop to play?
        if(this.song.sound) {
            // Force refresh
            return this.core.soundManager.playSong(this.song, true, true);
        }
    }).then(() => {
        if(newlyLinked) {
            this.setIndependentBuild(false);
        }
        this.updateInfo();
        this.core.updateBeatLength();
        // We may have to go backwards in time
        this.core.recalcBeatIndex();
        this.updateWaveform();
    }).catch(error => {
        console.log(error);
        this.alert("Couldn't load song! Is it a LAME encoded MP3?");
    });
};

HuesEditor.prototype.removeAudio = function(editor) {
    if(!this.song) {
        return;
    }
    
    this.song[editor._sound] = null;
    this.song[editor._rhythm] = "";
    this.setIndependentBuild(true);
    this.reflow(editor, "");
    // Is the loop playable?
    if(this.song.sound && this.linked) {
        this.core.soundManager.playSong(this.song, true, true)
        .then(() => {
            this.updateWaveform();
        });
    } else {
        this.core.soundManager.stop();
        this.updateWaveform();
    }
    this.updateInfo();
    this.updateHalveDoubleButtons(editor);
};

HuesEditor.prototype.blobToArrayBuffer = function(blob) {
    return new Promise((resolve, reject) => {
        let fr = new FileReader();
        fr.onload = () => {
            resolve(fr.result);
        };
        fr.onerror = () => {
            reject(new Error("File read failed!"));
        };
        fr.readAsArrayBuffer(blob);
    });
};

HuesEditor.prototype.newSong = function(song) {
    if(!song) {
        song = {"name":"Name",
           "title":"Title",
           "rhythm":"",
           "source":"",
           "sound":null,
           "enabled":true,
           "filename":null,
           "charsPerBeat": null,
           // Because new songs are empty
           "independentBuild": true};
       if(!this.respack) {
           this.respack = new Respack();
           this.respack.name = "Editor Respack";
           this.respack.author = "You!";
           this.respack.description = "An internal resourcepack for editing new songs";
           this.core.resourceManager.addPack(this.respack);
       }
       this.respack.songs.push(song);
       this.core.resourceManager.rebuildArrays();
       this.core.resourceManager.rebuildEnabled();
       this.core.setSongOject(song);
    }
    // Clear instructions
    this.buildEdit._hilight.className = "beat-hilight hidden";
    this.loopEdit._hilight.className = "beat-hilight hidden";
    
    // Clear helpful glows
    this.newSongBtn.classList.remove("glow");
    this.fromSongBtn.classList.remove("glow");
    
    // Enable title edits
    this.title.disabled = false;
    this.source.disabled = false;
    
    this.clearUndoRedo();
    
    this.song = song;
    this.reflow(this.buildEdit, song.buildupRhythm);
    this.reflow(this.loopEdit, song.rhythm);
    this.title.value = song.title;
    this.source.value = song.source;
    
    // Force independent build if only 1 source is present
    this.updateIndependentBuild();
    
    // Unlock beatmap lengths
    this.setLocked(this.buildEdit, 0);
    this.setLocked(this.loopEdit, 0);
    
    this.linked = true;
    this.updateInfo();
    this.updateWaveform();
};

HuesEditor.prototype.updateIndependentBuild = function() {
    // Force independent build if only 1 source is present
    
    // Effectively buildup XOR loop - does only 1 exist?
    let hasBuild = !!this.song.buildup;
    let hasLoop = !!this.song.sound;
    if(hasBuild != hasLoop) {
        this.setIndependentBuild(true);
    }
};

HuesEditor.prototype.setIndependentBuild = function(indep) {
    this.song.independentBuild = indep;
    if(!indep) {
        // If both are locked, we lock the result, otherwise unlock both
        let lock = this.loopEdit._locked && this.buildEdit._locked;
        // Then unlock both so text adjustment can occur
        this.loopEdit._locked = 0;
        this.buildEdit._locked = 0;
        // Correct the lengths
        this.setText(this.loopEdit, this.getText(this.loopEdit));
        // Restore locked state
        if(lock) {
            this.loopEdit._locked = this.song.rhythm.length;
            this.buildEdit._locked = this.song.buildupRhythm.length;
        }
    }
    this.updateInfo();
};

HuesEditor.prototype.batchUndo = function() {
    if(!this.batchUndoArray)
        this.batchUndoArray = [];
};

HuesEditor.prototype.commitUndo = function() {
    if(this.batchUndoArray) {
        this.undoBuffer.push(this.batchUndoArray);
        this.trimUndo();
        this.batchUndoArray = null;
        this.updateUndoUI();
    }
};

HuesEditor.prototype.pushUndo = function(name, editor, oldText, newText) {
    if(oldText == newText) {
        return;
    }
    this.redoBuffer = [];
    
    let undoObj = {songVar: name,
                   editor: editor,
                   text: oldText,
                   indep: this.song.independentBuild};
    if(this.batchUndoArray) {
        this.batchUndoArray.push(undoObj);
    } else {
        // 1 element array so undoRedo is neater
        this.undoBuffer.push([undoObj]);
        this.trimUndo();
    }
    this.updateUndoUI();
};

HuesEditor.prototype.trimUndo = function() {
    while(this.undoBuffer.length > 50) {
        this.undoBuffer.shift();
    }
};

HuesEditor.prototype.undo = function() {
    this.undoRedo(this.undoBuffer, this.redoBuffer);
};

HuesEditor.prototype.redo = function() {
    this.undoRedo(this.redoBuffer, this.undoBuffer);
};

HuesEditor.prototype.undoRedo = function(from, to) {
    if(from.length === 0 || !this.song) {
        return;
    }
    // Remove old data
    let fromArray = from.pop();
    let toArray = [];
    for(let i = 0; i < fromArray.length; i++) {
        let fromData = fromArray[i];
        // Make restore from current
        toArray.push({songVar: fromData.songVar,
                      editor: fromData.editor,
                      text: this.song[fromData.songVar],
                      indep: this.song.independentBuild});
        // Restore to editor
        this.song[fromData.songVar] = fromData.text;
        this.song.independentBuild = fromData.indep;
        // Don't have weird behaviour there
        if(fromData.editor._locked) {
            fromData.editor._locked = fromData.text.length;
        }
        this.reflow(fromData.editor, this.song[fromData.songVar]);
        this.updateHalveDoubleButtons(fromData.editor);
    }
    to.push(toArray);
    this.updateUndoUI();
    this.updateInfo();
    this.core.updateBeatLength();
    this.core.recalcBeatIndex();
};

HuesEditor.prototype.clearUndoRedo = function() {
    this.undoBuffer = [];
    this.redoBuffer = [];
    this.updateUndoUI();
};

HuesEditor.prototype.updateUndoUI = function() {
    this.undoBtn.className = "hues-button disabled";
    this.redoBtn.className = "hues-button disabled";
    
    if(this.undoBuffer.length > 0) {
        this.undoBtn.classList.remove("disabled");
    }
    if(this.redoBuffer.length > 0) {
        this.redoBtn.classList.remove("disabled");
    }
};

HuesEditor.prototype.halveBeats = function(editor) {
    let commit = false;
    if(!this.song.independentBuild) {
        commit = true;
        this.batchUndo();
        // halve them both
        let other = this.getOther(editor);
        this.song.independentBuild = true;
        this.halveBeats(other);
    }
    this.setText(editor, this.song[editor._rhythm].replace(/(.)./g, "$1"));
    if(commit) {
        this.commitUndo();
        // We set it so any rounding is padded
        this.setIndependentBuild(false);
    }
};

HuesEditor.prototype.doubleBeats = function(editor) {
    let commit = false;
    if(!this.song.independentBuild) {
        commit = true;
        this.batchUndo();
        // Double them both
        let other = this.getOther(editor);
        this.song.independentBuild = true;
        this.doubleBeats(other);
    }
    this.setText(editor, this.song[editor._rhythm].replace(/(.)/g, "$1."));
    if(commit) {
        this.commitUndo();
        // We set it so any rounding is padded
        this.setIndependentBuild(false);
    }
};

HuesEditor.prototype.updateHalveDoubleButtons = function(editor) {
    editor._halveBtn.className = "hues-button disabled";
    editor._doubleBtn.className = "hues-button disabled";

    if(!editor._locked) {
        let txtLen = this.getText(editor).length;
        if(!this.song.independentBuild) {
            let other = this.getOther(editor);
            txtLen = Math.min(txtLen, this.getText(other).length);
        }
        if(txtLen > 0) {
            editor._doubleBtn.className = "hues-button";
        }
        if(txtLen > 1) {
            editor._halveBtn.className = "hues-button";
        }
    }
};

HuesEditor.prototype.createTextInput = function(label, id, subtitle, parent) {
    let div = document.createElement("div");
    div.className = "edit-label";
    let caption = document.createElement("label");
    caption.innerHTML = label;
    caption.htmlFor = id;
    div.appendChild(caption);
    let container = document.createElement("span");
    container.className = "edit-textbox-container";
    let input = document.createElement("input");
    input.className = "edit-textbox";
    input.type = "text";
    input.id = id;
    input.value = subtitle;
    container.appendChild(input);
    div.appendChild(container);
    
    parent.appendChild(div);
    
    return input;
};

HuesEditor.prototype.createButton = function(label, parent, disabled, extraClass) {
    let button = document.createElement("span");
    button.className = "hues-button";
    if(disabled) {
        button.className += " disabled";
    }
    if(extraClass) {
        button.className += " " + extraClass;
    }
    // Automagically make disabled buttons ignore clicks
    button.addEventListener("click", event => {
        if(button.classList.contains("disabled")) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            return false;
        } else {
            return true;
        }
    });
    button.innerHTML = label.toUpperCase();
    parent.appendChild(button);
    return button;
};

HuesEditor.prototype.uiCreateInfo = function() {
    let info = document.createElement("div");
    this.topBar.appendChild(info);
    info.id = "edit-info";
    
    let songUpdate = function(name) {
        if(!this.song ) {
            return;
        }
        this.song[name] = this[name].value;
        if(this.song != this.core.currentSong) {
            return;
        }
        this.core.callEventListeners("newsong", this.song);
    };
    
    this.title = this.createTextInput("Title:", "edit-title", "Song name", info);
    this.title.oninput = songUpdate.bind(this, "title");
    this.title.disabled = true;
    this.source = this.createTextInput("Link:&nbsp;", "edit-source", "Source link", info);
    this.source.oninput = songUpdate.bind(this, "source");
    this.source.disabled = true;
};

HuesEditor.prototype.uiCreateImport = function() {
    let imports = document.createElement("div");
    this.topBar.appendChild(imports);
    imports.id = "edit-imports";
    
    let songEdits = document.createElement("div");
    imports.appendChild(songEdits);
    let newSongBtn = this.createButton("New song", songEdits, false, "glow");
    newSongBtn.addEventListener("click", () => {
        this.newSong();
    });
    this.newSongBtn = newSongBtn;
    let fromSong = this.createButton("Edit current song", songEdits, false, "glow");
    fromSong.addEventListener("click", () => {
        if(this.core.currentSong) {
            this.newSong(this.core.currentSong);
        }
    });
    this.fromSongBtn = fromSong;
    
    let songInfos = document.createElement("div");
    songInfos.className = "settings-individual";
    songInfos.id = "edit-songstats";
    imports.appendChild(songInfos);
    
    this.loopLen = this.uiCreateSongStat("Loop length (s):", "0.00", songInfos);
    this.buildLen = this.uiCreateSongStat("Build length (s):", "0.00", songInfos);
    this.beatLen = this.uiCreateSongStat("Beat length (ms):", "0.00", songInfos);
};

HuesEditor.prototype.uiCreateSongStat = function(name, value, parent) {
    let container = document.createElement("div");
    parent.appendChild(container);
    let label = document.createElement("span");
    label.textContent = name;
    container.appendChild(label);
    let valueSpan = document.createElement("span");
    valueSpan.textContent = value;
    valueSpan.className = "edit-songstat-value";
    container.appendChild(valueSpan);
    return valueSpan;
};

HuesEditor.prototype.uiCreateEditArea = function() {
    let editArea = document.createElement("div");
    this.editArea = editArea;
    editArea.id = "edit-area";
    this.root.appendChild(editArea);
    
    // Lock build/loop lengths
    this.timeLock = document.createElement("div");
    editArea.appendChild(this.timeLock);
    this.timeLock.id = "edit-timelock";
    this.timeLock.className = "hues-icon unlocked";
    // CHAIN-BROKEN, use &#xe905; for CHAIN
    let locker = this.createButton("&#xe904;", this.timeLock);
    locker.addEventListener("click", () => {
        if(!this.song) {
            return;
        }
        this.setIndependentBuild(!this.song.independentBuild);
    });
    this.timeLock._locker = locker;
    
    this.buildEdit = this.uiCreateSingleEditor("Buildup", "buildup", "buildupRhythm", "edit-build", editArea);
    this.seekStart = this.buildEdit._seek;
    // FIRST |<<
    this.seekStart.innerHTML = "&#xe90b;";
    this.seekStart.addEventListener("click", () => {
        this.core.soundManager.seek(-this.core.soundManager.buildLength);
    });
    
    // drag handle
    let handleContainer = document.createElement("div");
    handleContainer.id = "edit-resize-handle-container";
    editArea.appendChild(handleContainer);
    let handle = document.createElement("div");
    handle.id = 'edit-resize-handle';
    handle.className = 'hues-icon';
    handle.innerHTML = "&#xe908;"; // DRAG HANDLE
    handleContainer.appendChild(handle);
    this.resizeHandle = handleContainer;
    
    handleContainer.addEventListener("mousedown", (e) => {
        e.preventDefault();
        let editTop = this.editArea.getBoundingClientRect().top;
        let handleSize = this.resizeHandle.clientHeight;
        
        let resizer = (e) => {
            this.buildEditSize = Math.floor(e.clientY - editTop + handleSize/2);
            this.resize(true);
        };
        
        let mouseup = function(e) {
            document.removeEventListener("mousemove", resizer);
            document.removeEventListener("mouseup", mouseup);
        };
        
        document.addEventListener("mousemove", resizer);
        document.addEventListener("mouseup", mouseup);
    });

    this.loopEdit = this.uiCreateSingleEditor("Rhythm&nbsp;", "sound", "rhythm", "edit-loop", editArea);
    this.seekLoop = this.loopEdit._seek;
    // FIRST |<<
    this.seekLoop.innerHTML = "&#xe90b;";
    this.seekLoop.addEventListener("click", () => {
        this.core.soundManager.seek(0);
    });
    
    this.buildEdit._hilight.textContent = "[none]";
    this.loopEdit._hilight.innerHTML = 
        '<br />' + 
         'Click [LOAD RHYTHM] to load a loop! LAME encoded MP3s work best.<br />' + 
         '(LAME is important for seamless MP3 loops)<br />' +
         '<br />' +
         '[DOUBLE] doubles the selected map length by padding it with "."s.<br />' +
         '[HALVE] shortens the map length by removing every other character.<br />' +
         '<br />' +
         'You can also add a buildup with [LOAD BUILDUP], or remove it<br />' +
         'with [REMOVE].<br />' +
         '<br />' +
         '[NEW SONG] adds a completely empty song for you to edit, and<br />' +
         '[EDIT CURRENT SONG] takes the current playing song to the editor.<br />' +
         '<br />' +
         '[COPY/SAVE XML] allow for storing the rhythms and easy <br />' +
         'inclusion into a Resource Pack!';
};

HuesEditor.prototype.uiCreateSingleEditor = function(title, soundName, rhythmName, id, parent) {
    let container = document.createElement("div");
    container.id = id;
    parent.appendChild(container);
    
    let header = document.createElement("div");
    header.className = "edit-area-header";
    container.appendChild(header);
    
    let nameLabel = document.createElement("span");
    header.appendChild(nameLabel);
    nameLabel.innerHTML = title;
    
    let seek = this.createButton("", header, true, "hues-icon");
    header.appendChild(seek);
    container._seek = seek;
    
    let beatCount = document.createElement("span");
    header.appendChild(beatCount);
    beatCount.className = "beat-count";
    beatCount.textContent = "0 beats";
    container._lockedBtn = this.createButton("&#xe907;", header, false, "hues-icon");
    container._lockedBtn.addEventListener("click", () => {
        if(container._locked) {
            this.setLocked(container, 0);
        } else {
            let textLen = this.getText(container).length;
            this.setLocked(container, textLen);
        }
    });
    
    let rightHeader = document.createElement("span");
    rightHeader.className = "edit-area-right-header";
    header.appendChild(rightHeader);
    
    container._halveBtn = this.createButton("Halve", rightHeader, true);
    container._halveBtn.addEventListener("click", this.halveBeats.bind(this, container));
    container._doubleBtn = this.createButton("Double", rightHeader, true);
    container._doubleBtn.addEventListener("click", this.doubleBeats.bind(this, container));
    
    let fileInput = document.createElement("input");
    fileInput.type ="file";
    fileInput.accept="audio/mp3";
    fileInput.multiple = false;
    fileInput.onchange = this.loadAudio.bind(this, container);
    let load = this.createButton("Load " + title.replace(/&nbsp;/g,""), rightHeader);
    load.addEventListener("click", () => {fileInput.click();});
    
    container._removeBtn = this.createButton("Remove", rightHeader, true);
    container._removeBtn.addEventListener("click", this.removeAudio.bind(this, container));
    
    let editBox = document.createElement("div");
    editBox.className = "edit-box";
    let beatmap = document.createElement("div");
    beatmap.className = "beatmap";
    beatmap.contentEditable = true;
    beatmap.spellcheck = false;
    beatmap.oninput = this.textUpdated.bind(this, container);
    beatmap.oncontextmenu = this.rightClick.bind(this, container);
    
    let beatHilight = document.createElement("div");
    beatHilight.className = "beat-hilight";
    
    editBox.appendChild(beatHilight);
    editBox.appendChild(beatmap);
    container.appendChild(editBox);
    
    container._header = header;
    container._beatCount = beatCount;
    container._box = editBox;
    container._beatmap = beatmap;
    container._hilight = beatHilight;
    container._fileInput = fileInput;
    
    container._sound = soundName;
    container._rhythm = rhythmName;
        
    // Are we in insert mode? Default = no
    container._locked = 0;
    
    return container;
};

HuesEditor.prototype.uiCreateControls = function() {
    let controls = document.createElement("div");
    controls.id = "edit-controls";
    this.root.appendChild(controls);
    
    let changeRate = function(change) {
        let rate = this.core.soundManager.playbackRate;
        rate += change;
        this.core.soundManager.setRate(rate);
        // In case it gets clamped, check
        let newRate = this.core.soundManager.playbackRate;
        playRateLab.textContent = newRate.toFixed(2) + "x";
    };
    
    let speedControl = document.createElement("div");
    controls.appendChild(speedControl);
    
    // BACKWARD
    let speedDown = this.createButton("&#xe909;", speedControl, false, "hues-icon");
    speedDown.addEventListener("click", changeRate.bind(this, -0.25));
    // FORWARD
    let speedUp = this.createButton("&#xe90a;", speedControl, false, "hues-icon");
    speedUp.addEventListener("click", changeRate.bind(this, 0.25));
        
    let playRateLab = document.createElement("span");
    playRateLab.className = "settings-individual";
    playRateLab.textContent = "1.00x";
    speedControl.appendChild(playRateLab);
    
    let wrapControl = document.createElement("div");
    controls.appendChild(wrapControl);
    
    let wrapLab = document.createElement("span");
    wrapLab.className = "settings-individual";
    wrapLab.textContent = "New line at beat ";
    wrapControl.appendChild(wrapLab);
    
    let wrapAt = document.createElement("input");
    wrapAt.className = "settings-input";
    wrapAt.value = this.wrapAt;
    wrapAt.type = "text";
    wrapAt.oninput = () => {
        wrapAt.value = wrapAt.value.replace(/\D/g,'');
        if(wrapAt.value === "" || wrapAt.value < 1) {
            wrapAt.value = "";
            return;
        }
        this.wrapAt = parseInt(wrapAt.value);
        this.reflow(this.buildEdit, this.song.buildupRhythm);
        this.reflow(this.loopEdit, this.song.rhythm);
        
    };
    wrapControl.appendChild(wrapAt);
};

HuesEditor.prototype.uiCreateVisualiser = function() {
    // TODO placeholder
    let wave = document.createElement("canvas");
    wave.id = "edit-waveform";
    wave.height = WAVE_HEIGHT_PIXELS;
    this.root.appendChild(wave);
    this.waveCanvas = wave;
    this.waveContext = wave.getContext("2d");
    
    this.core.addEventListener("frame", this.drawWave.bind(this));
};

HuesEditor.prototype.rightClick = function(editor, event) {
    if(!this.linked) {
        return;
    }
    // We abuse the fact that right clicking moves the caret. Hooray!
    let caret = this.getCaret(editor._beatmap);
    let totalLen = this.getText(editor).length;
    let percent = caret / totalLen;
    if(caret <= totalLen) {
        let seekTime = 0;
        if(editor._rhythm == "rhythm") { // loop
            seekTime = this.core.soundManager.loopLength * percent;
        } else { // build
            let bLen = this.core.soundManager.buildLength;
            seekTime = -bLen + bLen * percent;
        }
        this.core.soundManager.seek(seekTime);
        event.preventDefault();
        return false;
    } else {
        return true;
    }
};

HuesEditor.prototype.textUpdated = function(editor) {
    if(!this.song || !this.song[editor._sound]) {
        this.reflow(editor, "");
        return;
    }
    // Space at start of line is nonbreaking, get it with \u00a0
    let input = editor._beatmap.textContent.replace(/ |\u00a0/g, "");
    if(input.length === 0) {
        input = ".";
    }
    this.setText(editor, input);
};

HuesEditor.prototype.getText = function(editor) {
    if(!this.song || !this.song[editor._rhythm]) {
        return "";
    } else {
        return this.song[editor._rhythm];
    }
};

HuesEditor.prototype.setText = function(editor, text, caretFromEnd) {
    if(!this.song || !this.song[editor._sound]) {
        this.reflow(editor, "");
        return;
    }
    let commitUndo = false;
    let caret = caretFromEnd ? text.length : this.getCaret(editor._beatmap);
    if(editor._locked) {
        caret = Math.min(editor._locked, caret);
        if(text.length > editor._locked) {
            // Works for pastes too! Removes the different between sizes from the caret position
            text = text.slice(0, caret) + text.slice(caret + (text.length - editor._locked), text.length);
        } else {
            while(text.length < editor._locked) {
                text += ".";
            }
        }
    // time to scale things to fit
    } else if(!this.song.independentBuild && this.song.buildupRhythm && this.song.rhythm) {
        let ratio;
        if(editor == this.loopEdit) {
             ratio = this.core.soundManager.loopLength / this.core.soundManager.buildLength;
        } else {
            ratio = this.core.soundManager.buildLength / this.core.soundManager.loopLength;
        }
        let newLen = Math.round(text.length / ratio);
        // We've tried to make the other map impossibly short, force us to be longer
        while(newLen === 0) {
            text += ".";
            newLen = Math.round(text.length / ratio);
        }
        let otherMap = this.getOther(editor);
        let wasLocked = otherMap._locked;
        // avoid infinite loop
        this.song.independentBuild = true;
        // clamp the length
        otherMap._locked = newLen;
        // Make undos also sync
        this.batchUndo();
        commitUndo = true;
        // Use setText to update undo state and fill/clamp beats
        this.setText(otherMap, this.song[otherMap._rhythm], true);
        // Restore
        this.song.independentBuild = false;
        // Otherwise we'll lose the new length on the next edit
        if(wasLocked) {
            otherMap._locked = newLen;
        } else {
            otherMap._locked = 0;
        }
        // Fix the buttons
        this.updateHalveDoubleButtons(otherMap);
    }
    this.pushUndo(editor._rhythm, editor, this.song[editor._rhythm], text);
    // If we were linked, commit our 2 edits as 1 undo state
    if(commitUndo) {
        this.commitUndo();
    }
    this.song[editor._rhythm] = text;
    this.reflow(editor, this.song[editor._rhythm]);
    this.setCaret(editor._beatmap, caret);
    this.updateHalveDoubleButtons(editor);
    
    this.core.updateBeatLength();
    // We may have to go backwards in time
    this.core.recalcBeatIndex();
    this.updateInfo();
};

HuesEditor.prototype.getCaret = function(editable) {
    let caret = 0;
    let sel = window.getSelection();
    if (sel.rangeCount) {
      let range = sel.getRangeAt(0);
      // <br> elements are empty, and pastes do weird things.
      // So don't go up in multiples of 2 for getCaret
      for(let i = 0; i < editable.childNodes.length; i++) {
          if (range.commonAncestorContainer == editable.childNodes[i]) {
              caret += range.endOffset;
            return caret;
          } else {
              caret += editable.childNodes[i].textContent.length;
          }
      }
    }
    return 0;
};

HuesEditor.prototype.setCaret = function(editable, caret) {
    let range = document.createRange();
    let sel = window.getSelection();
    // <br> elements mean children go up in multiples of 2
    for(let i = 0; i < editable.childNodes.length; i+= 2) {
        let textLen = editable.childNodes[i].textContent.length;
        if(caret > textLen) {
            caret -= textLen;
        } else {
            range.setStart(editable.childNodes[i], caret);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            break;
        }
    }
};

HuesEditor.prototype.setLocked = function(editor, locked) {
    editor._locked = locked;
    if(locked) {
        editor._lockedBtn.innerHTML = "&#xe906;"; // LOCKED
    } else {
        editor._lockedBtn.innerHTML = "&#xe907;"; // UNLOCKED
    }
    // Synchronise locks when lengths are linked
    if(!this.song.independentBuild) {
        this.song.independentBuild = true;
        this.setLocked(this.getOther(editor), locked);
        this.song.independentBuild = false;
    }
    this.updateHalveDoubleButtons(editor);
};

HuesEditor.prototype.updateWaveform = function() {
    if(this.buildWaveBuff != this.core.soundManager.buildup) {
        this.buildWaveBuff = this.core.soundManager.buildup;
        this.buildWave = this.renderWave(this.buildWaveBuff, this.core.soundManager.buildLength);
    }
    if(this.loopWaveBuff != this.core.soundManager.loop) {
        this.loopWaveBuff = this.core.soundManager.loop;
        this.loopWave = this.renderWave(this.loopWaveBuff, this.core.soundManager.loopLength);
    }
};

HuesEditor.prototype.renderWave = function(buffer, length) {
    if(!buffer) {
        return null;
    }
    // The individual wave section
    let wave = document.createElement("canvas");
    let waveContext = wave.getContext("2d");
    
    wave.height = WAVE_HEIGHT_PIXELS;
    wave.width = Math.floor(WAVE_PIXELS_PER_SECOND * length);
    
    let samplesPerPixel = Math.floor(buffer.sampleRate / WAVE_PIXELS_PER_SECOND);
    let waveData = [];
    for(let i = 0; i < buffer.numberOfChannels; i++) {
        waveData.push(buffer.getChannelData(i));
    }
    let channels = buffer.numberOfChannels;
    // Half pixel offset makes things look crisp
    let pixel = 0.5;
    let halfHeight = WAVE_HEIGHT_PIXELS/2;
    for(let i = 0; i < buffer.length; i += samplesPerPixel) {
        let min = 0, max = 0, avgHi = 0, avgLo = 0;
        let j;
        for(j = 0; j < samplesPerPixel && i + j < buffer.length; j++) {
            for(let chan = 0; chan < channels; chan++) {
                let sample = waveData[chan][i+j];
                if(sample > 0) {
                    avgHi += sample;
                } else {
                    avgLo += sample;
                }
                if(sample > max) max = sample;
                if(sample < min) min = sample;
            }
        }
        let maxPix = Math.floor(halfHeight + max * halfHeight);
        // Min is negative, addition is correct
        let minPix = Math.floor(halfHeight + min * halfHeight);
        waveContext.strokeStyle = "black";
        waveContext.globalAlpha = "1";
        waveContext.beginPath();
        waveContext.moveTo(pixel, maxPix);
        waveContext.lineTo(pixel, minPix);
        waveContext.stroke();
        
        // Draw the average too, gives a better feel for the wave
        avgHi /= j * channels;
        avgLo /= j * channels;
        let maxAvg = Math.floor(halfHeight + avgHi * halfHeight);
        let minAvg = Math.floor(halfHeight + avgLo * halfHeight);
        waveContext.strokeStyle = "white";
        waveContext.globalAlpha = "0.5";
        waveContext.beginPath();
        waveContext.moveTo(pixel, maxAvg);
        waveContext.lineTo(pixel, minAvg);
        waveContext.stroke();
        
        pixel+=1;
    }
    
    return wave;
};

HuesEditor.prototype.drawWave = function() {
    let width = this.waveCanvas.width;
    let now = this.core.soundManager.currentTime();
    let span = width / WAVE_PIXELS_PER_SECOND / 2;
    let minTime = now - span;
    let maxTime = now + span;
    
    this.waveContext.clearRect(0, 0, width, WAVE_HEIGHT_PIXELS);
    
    if(this.buildWave && minTime < 0) {
        let bLen = this.core.soundManager.buildLength;
        let center = Math.floor((now + bLen) / bLen * this.buildWave.width);
        this.drawOneWave(this.buildWave, center, width);
    }
    
    if(this.loopWave && maxTime > 0) {
        let loopLen = this.core.soundManager.loopLength;
        let clampedNow = (minTime % loopLen) + span;
        let center = Math.floor(clampedNow / loopLen * this.loopWave.width);
        this.drawOneWave(this.loopWave, center, width);
        
        let clampedNext = (maxTime % loopLen) - span;
        // We've looped and need to draw 2 things
        if(clampedNext < clampedNow) {
            let center = Math.floor(clampedNext / loopLen * this.loopWave.width);
            this.drawOneWave(this.loopWave, center, width);
        }
    }
    
    // trackbar
    this.waveContext.strokeStyle = "red";
    this.waveContext.beginPath();
    this.waveContext.moveTo(width/2, 0);
    this.waveContext.lineTo(width/2, WAVE_HEIGHT_PIXELS);
    this.waveContext.stroke();
};

HuesEditor.prototype.alert = function(msg) {
    this.statusMsg.classList.remove("fade");
    this.statusMsg.textContent = msg;
    // Trigger a reflow and thus restart the animation
    var useless = this.statusMsg.offsetWidth;
    this.statusMsg.classList.add("fade");
}

HuesEditor.prototype.drawOneWave = function(wave, center, width) {
    this.waveContext.drawImage(wave,
                               center - width/2, 0,        // source x/y
                               width, WAVE_HEIGHT_PIXELS,  // source width/height
                               0, 0,                       // dest x/y
                               width, WAVE_HEIGHT_PIXELS); // dest width/height
};

HuesEditor.prototype.generateXML = function() {
    if(!this.song) {
        return null;
    }
    // Yes, this is just a bunch of strings. Simple XML, simple method.

    let result = "  <song name=\"" + this.song.name + "\">\n";
    result += "    <title>" + this.song.title + "</title>\n";
    if(this.song.source) {
        result += "    <source>" + this.song.source + "</source>\n";
    }
	result += "    <rhythm>" + this.song.rhythm + "</rhythm>\n";
	if(this.song.buildup) {
        result += "    <buildup>" + this.song.buildupName + "</buildup>\n";
        result += "    <buildupRhythm>" + this.song.buildupRhythm + "</buildupRhythm>\n";
        if(this.song.independentBuild) {
            result += "    <independentBuild>true</independentBuild>\n";
        }
    }
	result += "  </song>\n";
    return result;
};

HuesEditor.prototype.saveXML = function() {
    let xml = this.generateXML();
    if(!xml) {
        return;
    }
    let result = "<songs>\n";
    result += xml;
    result += "</songs>\n";
    
    // http://stackoverflow.com/a/18197341
    let element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(result));
    element.setAttribute('download', "0x40Hues - " + this.song.name + ".xml");

    element.style.display = 'none';
    document.body.appendChild(element);

    element.click();

    document.body.removeChild(element);
};

// http://stackoverflow.com/a/30810322
HuesEditor.prototype.copyXML = function() {
    let text = this.generateXML();
    
    // Clicking when disabled
    if(!text) {
        return;
    }
    
    let textArea = document.createElement("textarea");
    textArea.id = "edit-copybox";

    textArea.value = text;

    document.body.appendChild(textArea);

    textArea.select();
    
    let success;

    try {
        success = document.execCommand('copy');
    } catch (err) {
        success = false;
    }
    
    document.body.removeChild(textArea);
    if(success) {
        this.alert("Beatmap XML copied to clipboard!");
    } else {
        this.alert("Copy failed! Try saving instead");
    }
};
    
window.HuesEditor = HuesEditor;

})(window, document);
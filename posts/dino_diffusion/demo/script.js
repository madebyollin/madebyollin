// super messy code oops
// the actual diffusion part is pretty simple

/**
 * Converts tensors to viewable blob images (much easier to deal with than base64)
 * @param {Tensor} tensor - RGB, CHW, float32 tensor to convert to image blob
 * @returns Promised Blob
 */
function tensorToBlobAsync(tensor) {
    const canvas = document.createElement("canvas");
    [canvas.height, canvas.width] = [tensor.dims[2], tensor.dims[3]];
    const ctx = canvas.getContext("2d");
    let outputImage = new ImageData(new Uint8ClampedArray(canvas.width * canvas.height * 4), canvas.width, canvas.height);
    for (let i = 0; i < outputImage.data.length; i++) {
        outputImage.data[i] = 255 * ((i&3) == 3 || tensor.data[(i&3) * canvas.height * canvas.width + (i>>2)]);
    }
    ctx.putImageData(outputImage, 0, 0);
    return new Promise((resolve, reject)=> {
        canvas.toBlob(resolve);
    });
}

/**
 * Clamp float to be within range
 * @param {float} x - value to clamp
 * @param {float} a - minimum value
 * @param {float} b - maximum value
 * @returns clamped value
 */
function clamp(x, a, b) {
    return Math.max(a, Math.min(x, b));
}

/**
 * Convert a linear index in a CHW, RGB patch to {y, x, c} coordinates in output image
 * @param {int} i - index into patch
 * @param {Task} task - task used to create patch
 * @param {int} h - height of patch
 * @param {int} w - width of patch
 * @returns Floating-point, unclamped coordinates into output image
 */
function patchIndexToImageCoords(i, task, h, w) {
    const c = Math.floor(i / (h * w));
    const y = (Math.floor(i / w) % h + 0.5) / h * task.hwIn + task.yIn - 0.5;
    const x = (i % w + 0.5) / w * task.hwIn + task.xIn - 0.5;
    return {y, x, c};
}

/**
 * Convert a linear index in a CHW, RGB patch to nearest linear index in the larger HWC, RGBA output image.
 * @param {int} i - index into patch
 * @param {Task} task - task used to create patch
 * @param {int} h - height of patch
 * @param {int} w - width of patch
 * @param {int} oh - height of output image
 * @param {int} ow - width of output image
 * @returns Index into HWC RGBA output image
 */
function patchIndexToImageIndex(i, task, h, w, oh, ow) {
    const coords = patchIndexToImageCoords(i, task, h, w);
    const outY = clamp(Math.round(coords.y), 0, oh - 1);
    const outX = clamp(Math.round(coords.x), 0, ow - 1);
    return (outY * ow + outX) * 4 + coords.c;
}

/**
 * Splat a given patch into the given output image, based on patch task description.
 * Patch overlap is handled, so that overlapping patches are alpha-blended together.
 * (Dynamic input sizes make ORT very sad so it's easier to handle patches manually)
 * @param {Tensor} patch - RGB, CHW float32 patch to write
 * @param {Task} task - Task describing the location of the patch
 * @param {ImageData} outputImage - Image to write patch into.
 */
function writePatchToImageWithFancyOverlapHandling(patch, task, outputImage) {
    const [h, w] = [patch.dims[2], patch.dims[3]];
    const overlap = ((task.hwIn - task.hwOut) + 1);
    for (let y = task.yIn; y < task.yIn + task.hwIn && y < outputImage.height; y++) {
        for (let x = task.xIn; x < task.xIn + task.hwIn && x < outputImage.width; x++) {
            const py = clamp(Math.round((y - task.yIn + 0.5) / task.hwIn * h - 0.5), 0, h - 1);
            const px = clamp(Math.round((x - task.xIn + 0.5) / task.hwIn * w - 0.5), 0, w - 1);
            // alpha follows an overlap-length linear ramp on the top-left of each patch,
            // except for the patches on the top or left edges of the entire image.
            let alphaX = clamp((y - task.yIn) / overlap + (task.yIn == 0), 0, 1);
            let alphaY = clamp((x - task.xIn) / overlap + (task.xIn == 0), 0, 1)
            let alpha = Math.min(alphaX, alphaY);
            for (let c = 0; c < 3; c++) {
                let v = 255 * patch.data[c * (h * w) + py * w + px];
                v = alpha * v + (1 - alpha) * outputImage.data[(y * outputImage.width + x) * 4 + c];
                outputImage.data[(y * outputImage.width + x) * 4 + c] = v;
            }
        }
    }
}

/**
 * Schedule that spends more time at high noise levels.
 * (Needed for reasonably vibrant results at small stepcounts)
 * @param {float} x - Noisiness under default linspace(1, 0) schedule.
 * @returns Adjusted noise level under the modified schedule.
 */
function noiseLevelSchedule(x) {
    const k = 0.2;
    return x * (1 + k) / (x + k);
}

function makeGenerator(network, patch, patchNoise, patchNoiseLevel, patchLowRes, patchCoords, patchGuidance, outputImage, renderResult) {
    // single step of denoising
    async function generatePatch(task) {
        // useful stuff
        const [nlIn, nlOut] = [noiseLevelSchedule(1 - task.step / task.steps), noiseLevelSchedule(1 - (task.step + 1) / task.steps)];
        const [h, w] = [patch.dims[2], patch.dims[3]];
        
        // fill input information
        patchNoiseLevel.data[0] = nlIn;
        if (task.step == 0) {
            // fill working image
            for (let i = 0; i < patch.data.length; i++) {
                patch.data[i] = patchNoise.data[i];
            }
            // fill lowres image
            for (let i = 0; i < patchLowRes.data.length; i++) {
                patchLowRes.data[i] = (task.stage == 0) ? -1 : outputImage.data[patchIndexToImageIndex(i, task, h, w, outputImage.height, outputImage.width)] / 255.0;
            }
            // fill coords
            for (let i = 0; i < patchCoords.data.length; i++) {
                const coords = patchIndexToImageCoords(i, task, h, w);
                patchCoords.data[i] = coords.c == 0 ? (coords.x / outputImage.width) : (coords.c == 1 ? (coords.y / outputImage.height) : 1);
            }
            // fill guidance
            if (task.stage > 0) {
                for (let i = 0; i < patchGuidance.data.length; i++) {
                    patchGuidance.data[i] = 1;
                }
            }
        }

        // perform denoising step
        const tickModel = Date.now();
        const denoised = (await network.run({"x": patch, "noise_level": patchNoiseLevel, "x_lowres": patchLowRes, "x_coords": patchCoords, "x_cond": patchGuidance})).denoised;
        const tockModel = Date.now();

        // start making timeline images
        const noisedImage = task.stage == 0 ? tensorToBlobAsync(patch) : null;
        const denoisedImage = task.stage == 0 ? tensorToBlobAsync(denoised) : null;

        // update working image
        const alpha = nlOut / nlIn;
        for (let i = 0; i < patch.data.length; i++) {
            patch.data[i] = alpha * patch.data[i] + (1 - alpha) * denoised.data[i];
        }

        // update rendering
        writePatchToImageWithFancyOverlapHandling(denoised, task, outputImage);

        renderResult({"done": false, "nlIn": nlIn, "nlOut": nlOut, "task": task, "modelTime_ms": tockModel - tickModel, "noised": noisedImage, "denoised": denoisedImage});
    }

    let generationHandle = null;
    function generate(stepsPerResolution) {
        // plan out the work we'll need for this image generation
        let patchTaskQueue = [];
        for (let i = 0; i < stepsPerResolution.length; i++) {
            const steps = stepsPerResolution[i];
            // extra patch here (the + 1) so we get some patch overlap and no ugly edges
            const patchesPerSide = i == 0 ? 1 : ((1 << i) + 1);
            const patchSidePx = Math.round(patch.dims[2] / patchesPerSide) * Math.round(outputImage.width / patch.dims[2]);
            const tasksInStage = patchesPerSide * patchesPerSide * steps;
            for (let t = 0; t < tasksInStage; t++) {
                const [patchY, patchX, step] = [Math.floor(t / patchesPerSide / steps), Math.floor(t / steps) % patchesPerSide, t % steps];
                patchTaskQueue.push({
                    "stage": i, "step": step, "steps": steps,
                    "xIn": patchX * patchSidePx, "yIn": patchY * patchSidePx, "hwIn": Math.round(outputImage.width / (1 << i)),
                    "xOut": patchX * patchSidePx, "yOut": patchY * patchSidePx, "hwOut": patchSidePx,
                    "progress": (t + 1) / tasksInStage
                });
            }
        }
        // if we're already generating something, stop doing that
        if (generationHandle) window.clearTimeout(generationHandle);
        // start generating the new thing
        const minFrameTime_ms = 10;
        function generateNextPatchInQueue() {
            if (patchTaskQueue.length == 0) return renderResult({"done": true});
            generatePatch(patchTaskQueue.shift()).then(() => {
                generationHandle = window.setTimeout(generateNextPatchInQueue, minFrameTime_ms);
            });
        }
        generationHandle = window.setTimeout(generateNextPatchInQueue, minFrameTime_ms);
    }
    return generate;
}

window.addEventListener("load", async () => {
    const [CHANNELS_IN, HEIGHT, WIDTH, UPSAMPLE] = [3, 64, 64, 8];

    // complicated image / progress rendering & hover preview stuff
    const canvasEl = document.querySelector("#output");
    const sketchPadEl = document.querySelector("#sketchpad");
    const previewEl = document.querySelector("#preview");
    const ctx = canvasEl.getContext("2d");
    const sketchCtx = sketchPadEl.getContext("2d");
    const previewCtx = previewEl.getContext("2d");
    const outputImage = new ImageData(new Uint8ClampedArray(HEIGHT * WIDTH * 4 * UPSAMPLE * UPSAMPLE), WIDTH * UPSAMPLE, HEIGHT * UPSAMPLE);
    outputImage.data.fill(255);
    [canvasEl.height, canvasEl.width] = [outputImage.height, outputImage.width];
    [previewEl.height, previewEl.width] = [outputImage.height, outputImage.width];
    [sketchPadEl.height, sketchPadEl.width] = [HEIGHT, WIDTH];

    let hoverPreview = false;
    let releaseHover = null;
    function renderResult(result) {
        ctx.putImageData(outputImage, 0, 0);
        if (!hoverPreview) {
            previewEl.style.opacity = 0;
        }
        result.task = result.task || {"progress": 0, "stage": -1};
        if (result.task.stage == 0) {
            const momentContainer = document.querySelector("#timeline");
            const moment = document.createElement("div");
            if (result.task.step == 0) {
                momentContainer.innerHTML = "";
            }
            momentContainer.append(moment);
            result.noised.then((blob) => {
                let image = document.createElement("img");
                image.src = URL.createObjectURL(blob);
                moment.prepend(image);
            });
            result.denoised.then((blob) => {
                let text = document.createElement("span");
                text.innerHTML = " &rarr; &#x1F996; &rarr; "; // rawr
                let image = document.createElement("img");
                image.src = URL.createObjectURL(blob);
                moment.onmouseenter = moment.ontouchstart = () => {
                    if (releaseHover) releaseHover();
                    hoverPreview = true;
                    moment.classList.add("pressed");
                    previewEl.style.opacity = 1;
                    previewCtx.drawImage(image, 0, 0, canvasEl.width, canvasEl.height);
                };
                let releaseHover = () => {
                    moment.classList.remove("pressed");
                    if (momentContainer.querySelector(".pressed") == null) {
                        // none selected
                        previewEl.style.opacity = 0;
                    }
                    hoverPreview = false;
                    releaseHover = null;
                }
                moment.onmouseleave = moment.ontouchcancel = moment.ontouchend = releaseHover;
                moment.append(text, image);
            });
        }
        if (result.task.step == 0) {
            for (let i = 0; i < 10; i++) document.querySelector("#progress").classList.remove(`stage${i}`);
            document.querySelector("#progress").classList.add(`stage${result.task.stage}`);
        }
        if (result.done) {
            canvasEl.toBlob((blob) => {
                document.querySelector("#c-d").href = URL.createObjectURL(blob);
                document.querySelector("#c-d").target = "_blank";
                document.querySelector("#c-d").classList.remove("inactive");
            });
        }
        document.querySelector("#progress").style.opacity = 1 - result.done;
        document.querySelector("#progress #bar").style.width = `${100 * result.task.progress}%`;
        if (result.modelTime_ms) document.querySelector("#stats").textContent = `${Math.round(result.modelTime_ms)} ms`;
    }
    // fill with blank image to start
    renderResult({});

    // load actual neural network stuff, log any errors
    ctx.textAlign = "center";
    ctx.fillStyle = "black";
    ctx.font = "bold 32px sans-serif";
    var network = null;
    try {
        ctx.fillText("Loading neural network...", outputImage.width / 2, outputImage.height / 2, outputImage.width);
        network = await ort.InferenceSession.create("./network.onnx", { executionProviders: ["webgl"] });
        // once it worked, show the controls
        renderResult({});
        ctx.font = "bold 24px sans-serif";
        ctx.fillText("Network loaded. Preparing generator...", outputImage.width / 2, outputImage.height / 2, outputImage.width);
        document.querySelector("#controls").style.visibility = "visible";
    } catch (error) {
        renderResult({});
        ctx.fillText("The neural network didn't load :(", outputImage.width / 2, outputImage.height / 2, outputImage.width);
        ctx.font = "16px sans-serif";
        ctx.fillText("Try a different computer / phone?", outputImage.width / 2, outputImage.height / 2 + 16, outputImage.width);
        ctx.fillStyle = "pink";
        ctx.font = "14px monospace";
        ctx.fillText(error, outputImage.width / 2, outputImage.height / 2 + 32, outputImage.width * 0.8);
        console.error(error);
    }
    const patch = new ort.Tensor("float32", new Float32Array(CHANNELS_IN * HEIGHT * WIDTH), [1, CHANNELS_IN, HEIGHT, WIDTH]);
    const patchNoise = new ort.Tensor("float32", new Float32Array(CHANNELS_IN * HEIGHT * WIDTH), [1, CHANNELS_IN, HEIGHT, WIDTH]);
    const patchNoiseLevel = new ort.Tensor("float32", new Float32Array(1), [1, 1, 1, 1]);
    const patchLowRes = new ort.Tensor("float32", new Float32Array(CHANNELS_IN * HEIGHT * WIDTH), [1, CHANNELS_IN, HEIGHT, WIDTH]);
    const patchCoords = new ort.Tensor("float32", new Float32Array(CHANNELS_IN * HEIGHT * WIDTH), [1, CHANNELS_IN, HEIGHT, WIDTH]);
    const patchGuidance = new ort.Tensor("float32", new Float32Array(CHANNELS_IN * HEIGHT * WIDTH), [1, CHANNELS_IN, HEIGHT, WIDTH]);

    // initial noise
    function resample() {
        for (let i = 0; i < patchNoise.data.length; i++) patchNoise.data[i] = Math.random();
    }
    resample();

    // set up image generator
    const generator = makeGenerator(network, patch, patchNoise, patchNoiseLevel, patchLowRes, patchCoords, patchGuidance, outputImage, renderResult);

    function regenerate() {
        const steps = parseInt(document.querySelector("#steps input").value);
        const guidanceImage = sketchCtx.getImageData(0, 0, sketchPadEl.width, sketchPadEl.height);
        for (let c = 0; c < CHANNELS_IN; c++) {
            for (let i = 0; i < sketchPadEl.width * sketchPadEl.height; i++) {
                patchGuidance.data[c * HEIGHT * WIDTH + i] = guidanceImage.data[4 * i] / 255;
            }
        }
        generator([steps, Math.max(1, Math.floor(steps / 10)), Math.max(1, Math.floor(steps / 20)), Math.max(1, Math.floor(steps / 25))]);
    }

    // set up sketchpad
    sketchCtx.fill()
    sketchCtx.fillStyle = 'white';
    sketchCtx.fillRect(0, 0, sketchPadEl.width, sketchPadEl.height);
    let pencil = { pressed: false, x: 0, y: 0, side: "nib", drew: false };
    function sketchCoords(ev) {
        if (!ev) return {x: null, y: null};
        const c = sketchPadEl.getBoundingClientRect();
        const x = (ev.clientX - c.x + 0.5) / sketchPadEl.clientWidth * sketchPadEl.width - 0.5;
        const y = (ev.clientY - c.y + 0.5) / sketchPadEl.clientHeight * sketchPadEl.height - 0.5;
        return {x, y};
    }
    function sketchLine(x0f, y0f, x1f, y1f, side) {
        let [x0, y0, x1, y1] = [x0f, y0f, x1f, y1f].map(Math.floor);
        const [dx, dy] = [Math.abs(x1 - x0), -Math.abs(y1 - y0)];
        const sx = x0 < x1 ? 1 : -1;
        const sy = y0 < y1 ? 1 : -1;
        let error = dx + dy;
        for (let i = 0; i < 128; i++) {
            if (side == "nib") {
                sketchCtx.fillRect(x0, y0, 1, 1);
            } else {
                sketchCtx.fillRect(x0 - 3, y0 - 3, 7, 7);
            }
            if (x0 == x1 && y0 == y1) break;
            let e2 = 2 * error;
            if (e2 >= dy) {
                if (x0 == x1) break;
                error = error + dy;
                x0 = x0 + sx;
            }
            if (e2 <= dx) {
                if (y0 == y1) break;
                error = error + dx;
                y0 = y0 + sy;
            }
        }
    }
    function updateLine(ev) {
        if (ev.touches) { ev = ev.touches[0]; }
        const coords = sketchCoords(ev);
        if (pencil.pressed) {
            sketchCtx.fillStyle = pencil.side == "nib" ? "black" : "white";
            sketchLine(pencil.x, pencil.y, coords.x, coords.y, pencil.side);
            pencil.drew = true;
        }
        [pencil.x, pencil.y] = [coords.x, coords.y];
    }
    sketchPadEl.onmousedown = sketchPadEl.ontouchstart = (ev) => {
        pencil.pressed = false;
        updateLine(ev);
        pencil.pressed = true;
        updateLine(ev);
    };

    sketchPadEl.parentElement.addEventListener("touchstart", (ev) => ev.preventDefault());
    sketchPadEl.parentElement.addEventListener("touchmove", (ev) => ev.preventDefault());

    document.body.onmousemove = document.body.ontouchmove = (ev) => {
        updateLine(ev);
    };
    document.body.onmouseup = document.body.ontouchend = document.body.ontouchcancel = document.body.onmouseleave = (ev) => {
        pencil.pressed = false;
        updateLine(ev);
        hideOrShowSketchpad();
    };

    function hideOrShowSketchpad() {
        if (Array.from(document.querySelectorAll(".c.tool")).some((el) => el.classList.contains("pressed"))) {
            sketchPadEl.classList.add("pressed");
        } else {
            sketchPadEl.classList.remove("pressed");
            // reset pencil
            pencil.side = "nib";
            if (pencil.drew) {
                regenerate();
                pencil.drew = false;
            }
        }
    }

    function hideSketchpad() {
        Array.from(document.querySelectorAll(".c.tool")).forEach((el) => el.classList.remove("pressed"));
        hideOrShowSketchpad();
    }

    // allow drawing even if no tool is selected...
    sketchPadEl.addEventListener("mousedown", (ev) => {
        sketchPadEl.classList.add("pressed");
        if (pencil.side == "nib") document.querySelector("#c-s").classList.add("pressed");
    });
    sketchPadEl.addEventListener("touchstart", (ev) => {
        sketchPadEl.classList.add("pressed");
        if (pencil.side == "nib") document.querySelector("#c-s").classList.add("pressed");
    });

    document.querySelector("#c-s").onclick = (ev) => {
        if (ev.target.classList.contains("pressed")) {
            ev.target.classList.remove("pressed");
        } else {
            pencil.side = "nib";
            ev.target.classList.add("pressed");
            document.querySelector("#c-e").classList.remove("pressed");
        }
        hideOrShowSketchpad();
    }

    document.querySelector("#c-e").onclick = (ev) => {
        if (ev.target.classList.contains("pressed")) {
            ev.target.classList.remove("pressed");
        } else {
            pencil.side = "eraser";
            ev.target.classList.add("pressed");
            document.querySelector("#c-s").classList.remove("pressed");
        }
        hideOrShowSketchpad();
    }

    // reset button creates new latents
    document.querySelector("#c-r").onmousedown = document.querySelector("#c-r").ontouchstart = ev => ev.target.classList.add("pressed");
    document.querySelector("#c-r").onclick = ev => {
        ev.target.classList.remove("pressed");
        hideSketchpad();
        resample();
        regenerate();
    }

    // help button toggles help text
    document.querySelector("#c-h").onclick = () => {
        hideSketchpad();
        ["#c-h", "#help"].map(q=>document.querySelector(q).classList.toggle("pressed"));
        const helpButton = document.querySelector("#c-h")
        // ugh
        for (let cs of ["c-s", "c-e", "c-r", "c-d", "steps", "stats", "easel", "progress", "timeline"]) {
            c = document.querySelector(`#${cs}`);
            if (helpButton.classList.contains("pressed")) {
                c.style.display = "none";
            } else {
                c.style.display = null;
            }
        }
    }
    
    document.querySelector("#c-d").onclick = (ev) => {
        if (!ev.target.classList.contains("inactive")) {
            ev.target.classList.add("pressed")
            window.setTimeout(() => ev.target.classList.remove("pressed"), 50);
        }
    }

    // keys are shortcuts for buttons
    document.addEventListener("keydown", ev => {
        if (ev.key == "Escape" || ev.key == " ") document.querySelector("#c-r").click();
        if (ev.key == "Escape" && document.querySelector("#c-h").classList.contains("pressed")) document.querySelector("#c-h").click();
        if (ev.key == "?") document.querySelector("#c-h").click();
        if (ev.key == "b" || ev.key == "c") document.querySelector("#c-s").click();
        if (ev.key == "e" || ev.key == "s") document.querySelector("#c-e").click();
    });

    // slider controls a label
    function makeStepsLabelMatchSlider() {
        document.querySelector("#steps span").textContent = document.querySelector("#steps input").value;;
    }
    document.querySelector("#steps input").oninput = makeStepsLabelMatchSlider;
    document.querySelector("#steps input").onchange = regenerate;
    makeStepsLabelMatchSlider();

    // hide sketchpad whenever you click anywhere else
    document.body.addEventListener("mousedown", (ev) => {
        if (ev.target == document.body) {
            hideSketchpad();
        }
    });

    // generate an image when the page loads
    document.querySelector("#c-r").click();
});

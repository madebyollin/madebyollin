// This file contains the main game rendering loops and binding to UI / controls.
// The actual world generation is the single line "network.run(networkInputsForFrame)" :)

// control / player logic is bound in global scope so you can easily mess with it from js console
const swfl = Strafewafel();

window.addEventListener("load", async () => {
    // check if we're running locally and want additional debugging stuff
    const isLocalDebug = window.location.hostname == "localhost" || window.location.hostname.startsWith("192.");

    // logical state of the world simulation
    let worldState = { readyToRender: true, paused: false, steppedSingleFrame: false, needsReset: false, time_s: 0.0 };

    // pick network file to load 
    function decideONNXUrl(loc)
    {
        let onnxURL = "./model.onnx"
        // break caches on localhost to make testing easy
        if (isLocalDebug) onnxURL += `?cache_break=${Math.random()}`;
        return onnxURL;
    }

    // set up network preprocessing and postprocessing stuff
    const nwr = NWR();

    // set up graphics context to write to
    const canvasEl = document.querySelector("canvas");
    [canvasEl.height, canvasEl.width] = [nwr.constants.image.height, nwr.constants.image.width];
    const ctx = canvasEl.getContext("2d");
    const outputImage = new ImageData(new Uint8ClampedArray(nwr.constants.image.height * nwr.constants.image.width * 4), nwr.constants.image.width, nwr.constants.image.height);

    // bind controls to page
    swfl.addDefaultEventListeners(document.body, canvasEl);
    swfl.addDefaultControlElements(document.querySelector("main"));

    // load the network file, log any errors
    ctx.textAlign = "center";
    ctx.fillStyle = "white";
    ctx.font = "bold 16px sans-serif";
    let network = null;

    function ctxClear(ctx, color) {
        const fillStyle = ctx.fillStyle;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
        ctx.fillStyle = fillStyle;
    }

    try {
        ctx.fillText("Loading...", outputImage.width / 2, outputImage.height / 2, outputImage.width);
        network = await ort.InferenceSession.create(decideONNXUrl(window.location), { executionProviders: ["webgl"] });
    } catch (error) {
        ctxClear(ctx, "black");
        ctx.fillText("World failed to load", outputImage.width / 2, outputImage.height / 2 - 16, outputImage.width);
        ctx.font = "12px sans-serif";
        ctx.fillText("Try a different computer / phone?", outputImage.width / 2, outputImage.height / 2, outputImage.width);
        ctx.fillStyle = "gray";
        ctx.fillText(error, outputImage.width / 2, outputImage.height / 2 + 16, outputImage.width * 0.8);
        console.error(error);
        throw error;
    }

    // set up stat counting
    const stats = { frames: 0, seconds: 0, min_frame_time_ms: 10000.0 };

    function renderStats() {
        if (stats.frames > 0) {
            let statString = `${(stats.frames / stats.seconds).toFixed(0)} FPS`
            document.querySelector("#stats").innerHTML = statString;
        }
    }

    function togglePaused() {
        worldState.paused = !worldState.paused;
    }

    function queueReset() {
        worldState.needsReset = true;
    }

    // add additional keybindings for player controls
    document.addEventListener("keydown", ev => {
        if (ev.key == "r") {
            // reset network memory and stuff
            queueReset();
        }
        if (ev.key == "p") {
            // secret paused mode
            togglePaused();
        }
        if (ev.key == ".") {
            // secret frame-by-frame
            worldState.steppedSingleFrame = true;
        }
    });

    // add additional binding letting you pause via tapping stats bubble (nice on mobile)
    document.querySelector("#stats").addEventListener("pointerdown", togglePaused);
    // add reset binding (cancellable)
    document.querySelector("#reset").addEventListener("click", queueReset);

    // set up main rendering loop
    function renderWorldFrame(lastStepTime_ms, now_ms) {
        // block further enqueues
        worldState.readyToRender = false;
        // check for reset, which would mean we need to erase the state before enqueuing the next frame
        if (worldState.needsReset) {
            nwr.resetState();
            swfl.resetPlayerState();
            worldState.needsReset = false;
        }
        // add a new state to player history. neural world expects 60fps max update rate and ~15fps min, so enforce that
        worldState.time_s += Math.min(1/15, (now_ms - lastStepTime_ms) / 1000.0);
        nwr.addNewPlayerState({state: swfl.state, timeStamp_s: Math.round(60.0 * worldState.time_s) / 60.0});
        // prepare input tensors for network
        const networkInputsForFrame = nwr.prepareNetworkInputs();

        // run the network on the new inputs to get the rasterized frame
        network.run(networkInputsForFrame).then(outputTensors => {
            // retrieve the rasterized frame
            const outputFrameTensor = outputTensors.output;

            // copy network's RGB CHW float32 image into RGBA HWC uint8 image
            const brightness = 255.0 * Math.min(5.0 * worldState.time_s, 1.0); // fade in
            for (let i = 0; i < outputImage.data.length; i++) {
                outputImage.data[i] = brightness * ((i&3) == 3 || outputFrameTensor.data[(i&3) * nwr.constants.image.height * nwr.constants.image.width + (i>>2)]);
            }
            // draw to screen
            ctx.putImageData(outputImage, 0, 0);

            // update internal memory buffer
            nwr.addNewOutputFrame(outputFrameTensor.data);

            // update fps counter
            stats.frames += 1;
            stats.seconds += (now_ms - lastStepTime_ms) / 1000.0;
            stats.min_frame_time_ms = Math.min(stats.min_frame_time_ms, now_ms - lastStepTime_ms);

            // send perf logging to server (localhost only)
            if (isLocalDebug) {
                if (stats.frames == 100) fetch(`./set_stats?time_ms=${1000.0 * stats.seconds / stats.frames}&user_agent=${navigator.userAgent}&count=${stats.frames}&min_frame_time_ms=${stats.min_frame_time_ms}`);
            }

            // unblock, ready for next frame
            worldState.readyToRender = true;
        });
    }

    // main rendering loop
    let lastStepWorldTime_ms = null;
    function stepWorld(now_ms) {
        // time may be null
        if (lastStepWorldTime_ms == null) {
            lastStepWorldTime_ms = now_ms;
        }

        // enqueue a new frame if all signals are go
		if (worldState.readyToRender && (!worldState.paused || worldState.steppedSingleFrame)) {
            renderWorldFrame(lastStepWorldTime_ms, now_ms);
            worldState.steppedSingleFrame = false;
		}

        // continue loop
        lastStepWorldTime_ms = now_ms;
        requestAnimationFrame(stepWorld);
    }
    requestAnimationFrame(stepWorld);

    // UI rendering & controls loop
    let lastStepControlsTime_ms = null;
    function stepControls(now_ms) {
        if (lastStepControlsTime_ms == null) {
            lastStepControlsTime_ms = now_ms;
            ctxClear(ctx, "black");
            ctx.fillStyle = "gray";
            ctx.fillText("Initializing...", outputImage.width / 2, outputImage.height / 2, outputImage.width);
        }
        swfl.step((now_ms - lastStepControlsTime_ms) / 1000.0);
        swfl.updateControlElements();
        lastStepControlsTime_ms = now_ms;
        requestAnimationFrame(stepControls);
    }
    requestAnimationFrame(stepControls);

    // stats / fps rendering loop
    window.setInterval(renderStats, 500);
});

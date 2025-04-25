// This file contains the Neural World Runner (preprocessing / postprocessing / rollout code).
// It doesn't handle the actual model inference at the moment, just the surrounding logic that
// didn't make sense to bake into the ONNX graph.

function NWR() {
    // utility functions
    const util = {
        allocCHW: (c, h, w) => new ort.Tensor("float32", new Float32Array(c*h*w), [1, c, h, w]),
        avgPool2dCHWQuantized: (x, inHW, outHW, channels) => {
            const out = new Float32Array(channels * outHW.height * outHW.width);
            const pool = {y: inHW.height / outHW.height, x: inHW.width / outHW.width};
            for (let c = 0; c < channels; c++) {
                for (let i = 0; i < inHW.height; i++) {
                    for (let j = 0; j < inHW.width; j++) {
                        const xIdx = c * inHW.height * inHW.width + i * inHW.width + j;
                        const outIdx = c * outHW.height * outHW.width + Math.floor(i/pool.y) * outHW.width + Math.floor(j/pool.x);
                        out[outIdx] += Math.max(0.0, Math.min(x[xIdx], 1.0));
                    }
                }
            }
            for (let i = 0; i < out.length; i++) {
                out[i] = Math.round(out[i] / pool.y / pool.x * 255.0)/255.0;
            }
            return out; 
        },
        fillRand: (x) => { for (let i = 0; i < x.length; i++) { x[i] = Math.random(); } },
    };

    // hard-coded constants
    const C = {
        controls: { channels: 16 },
        noise: { channels: 1 },
        image: { height: 192, width: 256, channels: 3 },
        scale0: { height: 3, width: 4, nPast: 32 },
        scale1: { height: 12, width: 16, nPast: 16 },
        scale2: { height: 48, width: 64, nPast: 8 },
        scale3: { height: 192, width: 256, nPast: 4 },
    };

    // derived constants
    const D = {
        imageNumel: C.image.height * C.image.width * C.image.channels,
        stateHistorySize: 1 + C.scale0.nPast,
        scale0: { pastChannels: C.scale0.nPast * C.image.channels },
        scale1: { pastChannels: C.scale1.nPast * C.image.channels },
        scale2: { pastChannels: C.scale2.nPast * C.image.channels },
        scale3: { pastChannels: C.scale3.nPast * C.image.channels },
    };

    // network inputs
    const inputDict = {
        controls: util.allocCHW(C.controls.channels, 1, 1),
        // noise is per-block
        noise_0: util.allocCHW(C.noise.channels, C.scale0.height, C.scale0.width),
        noise_1: util.allocCHW(C.noise.channels, C.scale1.height, C.scale1.width),
        noise_2: util.allocCHW(C.noise.channels, C.scale2.height, C.scale2.width),
        noise_3: util.allocCHW(C.noise.channels, C.scale3.height, C.scale3.width),
        // past images (memory buffer) is also per-block
        past_0: util.allocCHW(D.scale0.pastChannels, C.scale0.height, C.scale0.width),
        past_1: util.allocCHW(D.scale1.pastChannels, C.scale1.height, C.scale1.width),
        past_2: util.allocCHW(D.scale2.pastChannels, C.scale2.height, C.scale2.width),
        past_3: util.allocCHW(D.scale3.pastChannels, C.scale3.height, C.scale3.width),
    };

    // past-state buffers
    const state = {
        player: [],
        frames: {
            scale0: [],
            scale1: [],
            scale2: [],
            scale3: [],
        },
    };

    function trimStateHistory()
    {
        while (state.player.length > D.stateHistorySize) {
            state.player.shift();
            state.frames.scale0.shift();
            state.frames.scale1.shift();
            state.frames.scale2.shift();
            state.frames.scale3.shift();
        }
    }

    function addNewPlayerState(stateAndTimestamp)
    {
        console.assert(state.player.length == state.frames.scale0.length, "Cannot add new player state until previous output frame has been added.", state.player.length, state.frames.scale0.length);
        state.player.push(JSON.parse(JSON.stringify(stateAndTimestamp))); // TODO: fix this horrible idiom
        trimStateHistory();
    }

    function addNewOutputFrame(outputFrameData)
    {
        console.assert(state.player.length == state.frames.scale0.length + 1, "Cannot add new frame state before new player state has been added.");
        console.assert(outputFrameData.length == D.imageNumel, "Invalid frame data", outputFrameData);
        // TODO: this shouldn't be done on cpu lol (it's just a mipmap!) but whatever
        const frameScale3 = util.avgPool2dCHWQuantized(outputFrameData, C.scale3, C.scale3, C.image.channels);
        const frameScale2 = util.avgPool2dCHWQuantized(frameScale3, C.scale3, C.scale2, C.image.channels);
        const frameScale1 = util.avgPool2dCHWQuantized(frameScale2, C.scale2, C.scale1, C.image.channels);
        const frameScale0 = util.avgPool2dCHWQuantized(frameScale1, C.scale1, C.scale0, C.image.channels);
        state.frames.scale3.push(frameScale3);
        state.frames.scale2.push(frameScale2);
        state.frames.scale1.push(frameScale1);
        state.frames.scale0.push(frameScale0);
    }

    function fillPastInput(out, scaleInfo, frames)
    {
        for (let t = 0; t < scaleInfo.nPast; t++) {
            const inFrameIdx = frames.length - scaleInfo.nPast + t;
            if (inFrameIdx < 0) continue; // assume it's already zeroed
            const inFrame = frames[inFrameIdx];
            const outOffset = t * C.image.channels * scaleInfo.height * scaleInfo.width;
            for (let i = 0; i < C.image.channels * scaleInfo.height * scaleInfo.width; i++) {
                out[outOffset + i] = inFrame[i];
            }
        }
    }

    function controlsToRtMatrix(rpy, xyz) {
        const [cr, sr, cp, sp, cy, sy] = [Math.cos(rpy.roll), Math.sin(rpy.roll), Math.cos(rpy.pitch), Math.sin(rpy.pitch), Math.cos(rpy.yaw), Math.sin(rpy.yaw)];
        return [
            [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr, xyz.x],
            [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr, xyz.y],
            [-sp, cp * sr, cp * cr, xyz.z],
            [0, 0, 0, 1]
        ];
    }

    function getRelativeRTMatrix(currentPose, referencePose) {
        // Compute referencePose inverse
        const [R, t] = [referencePose.slice(0, 3).map(row => row.slice(0, 3)), referencePose.slice(0, 3).map(row => row[3])];
        const Rt = R[0].map((_, i) => R.map(row => row[i])); // Transpose of R
        const tInv = Rt.map(row => -row.reduce((sum, val, i) => sum + val * t[i], 0));

        // Combine Rt and tInv into referenceInv
        const referenceInv = [...Rt.map((row, i) => [...row, tInv[i]]), [0, 0, 0, 1]];

        // Matrix multiplication
        return referenceInv.map(row =>
            currentPose[0].map((_, j) => row.reduce((sum, val, k) => sum + val * currentPose[k][j], 0))
        );
    }

    function fillControlsInput(out, prevState, nextState) {
        if (!prevState || !nextState) return; // TODO: do we care about this case?
        const prevRt = controlsToRtMatrix(prevState.state.view_r, prevState.state.position_m);
        const nextRt = controlsToRtMatrix(nextState.state.view_r, nextState.state.position_m);
        const relativeRt = getRelativeRTMatrix(nextRt, prevRt);

        // 3x4 Rt (relative camera pose)
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 4; j++) {
                out[i*4 + j] = relativeRt[i][j];
            }
        }
        // roll and pitch (absolute gravity vector)
        out[12] = prevState.state.view_r.roll;
        out[13] = prevState.state.view_r.pitch;
        // time delta (relative frame time)
        out[14] = nextState.timeStamp_s - prevState.timeStamp_s;
        // validity
        out[15] = 1;
    }

    function prepareNetworkInputs()
    {
        fillControlsInput(inputDict.controls.data, state.player[state.player.length - 2], state.player[state.player.length - 1]);
        util.fillRand(inputDict.noise_0.data);
        util.fillRand(inputDict.noise_1.data);
        util.fillRand(inputDict.noise_2.data);
        util.fillRand(inputDict.noise_3.data);
        fillPastInput(inputDict.past_0.data, C.scale0, state.frames.scale0);
        fillPastInput(inputDict.past_1.data, C.scale1, state.frames.scale1);
        fillPastInput(inputDict.past_2.data, C.scale2, state.frames.scale2);
        fillPastInput(inputDict.past_3.data, C.scale3, state.frames.scale3);
        return inputDict;
    }

    function resetState() {
        for (let arr of [state.player, state.frames.scale0, state.frames.scale1, state.frames.scale2, state.frames.scale3]) arr.length = 0;
        for (let k in inputDict) inputDict[k].data.fill(0);
    }

    return {
        constants: C,
        derivedConstants: D,
        resetState,
        addNewPlayerState,
        addNewOutputFrame,
        prepareNetworkInputs,
    };
}

// SPDX-License-Identifier: CC0-1.0
// The Calibrations tab: the Try Yarn Spinner showcase story (markup,
// enums, functions, commands, a saliency-driven node group) over the shared
// transcript runner — the "play only" view of the official sample, byte
// for byte from https://try.yarnspinner.dev/samples/Calibrations.yarn.
import calibrations from "../content/calibrations/calibrations.yarnproject";
import { mountTranscriptDemo } from "./transcriptDemo.js";

export function mountCalibrationsDemo(root: HTMLElement): void {
  mountTranscriptDemo(root, calibrations);
}

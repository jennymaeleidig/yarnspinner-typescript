// SPDX-License-Identifier: CC0-1.0
// The Crossroads tab: the Try crossroads sample over the shared transcript
// runner.
import crossroads from "../content/crossroads/crossroads.yarnproject";
import { mountTranscriptDemo } from "./transcriptDemo.js";

export function mountCrossroadsDemo(root: HTMLElement): void {
  mountTranscriptDemo(root, crossroads);
}

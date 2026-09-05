<script lang="ts">
	import { Dialogue, noOptionSelected, runUntilStopped } from "yarnspinner-typescript";
	import type { Diagnostic, Program, Transcript } from "yarnspinner-typescript";

	/**
	 * The SvelteKit host's dialogue component: `Dialogue`'s pull-based continue loop runs natively in Svelte —
	 * runes state, no framework adapter, zero React in the tree. The only
	 * props are the compiled program — the serializable artifact (ADR 0001)
	 * the server load handed across the load boundary — plus loader context.
	 * This module imports the package's browser-safe main entry only
	 * (coding standard §2); file access lives entirely in +page.server.ts.
	 *
	 * Variable-storage reset: every variable — story variables, once-state,
	 * visit counts — lives in the Dialogue's storage (coding standard §4), so
	 * Reset discards the instance and the next dialogue is born fresh: the
	 * `<<declare>>` seeds reapply and the story replays from the top.
	 */
	interface Props {
		/** The compiled program from the server-side `loadYarnProject()` call. */
		program: Program;
		projectName?: string | null;
		/** The source files the loader resolved — surfaced like `listSources()`. */
		sources: string[];
		/** Structured loader diagnostics (warnings ride along; errors never reach here). */
		diagnostics: Diagnostic[];
	}

	let { program, projectName = null, sources, diagnostics }: Props = $props();

	/** The transcript (CONTEXT.md) is the component state: lines accumulate,
	 *  the live option set renders when present, commands accumulate. */

	/** A fresh Dialogue is a fresh variable storage. The first pull runs
	 *  during the initial render — the shared runUntilStopped module, run
	 *  during render — on the server too, so the opening line is in the SSR
	 *  output. */
	function freshHost() {
		const dialogue = new Dialogue(program);
		return {
			dialogue,
			transcript: runUntilStopped(dialogue).transcript,
			variables: { ...dialogue.getVariables() },
		};
	}

	// Raw, not deep: the Dialogue is a class instance held by reference — the
	// runtime object is not reactive surface; state changes replace the whole
	// `host` record (reassignment is what's reactive).
	let host = $state.raw(freshHost());

	/** Deliver a new transcript and the dialogue's current variables. */
	function deliver(dialogue: Dialogue, transcript: Transcript) {
		host = {
			dialogue,
			transcript,
			variables: { ...dialogue.getVariables() },
		};
	}

	/** One pull of the loop: deliver the next stopping point's events. The
	 *  module's at-rest guards (pending selection, complete) make this a
	 *  no-op when the dialogue has nothing to deliver. */
	function onContinue() {
		deliver(host.dialogue, runUntilStopped(host.dialogue, host.transcript).transcript);
	}

	/** Resume a delivered option set: select, then pull through its body —
	 *  the resolved set leaves the transcript (module contract). */
	function onOption(selected: number) {
		host.dialogue.selectOption(selected);
		deliver(host.dialogue, runUntilStopped(host.dialogue, host.transcript).transcript);
	}

	/** Variable-storage reset (coding standard §4): discard the Dialogue; the
	 *  next dialogue is born fresh — declares reseed, generated state clears. */
	function onReset() {
		host = freshHost();
	}
</script>

<main>
	<header>
		<h1>
			{projectName ?? "Yarn project"}
			<span>— SvelteKit host</span>
		</h1>
		<p>
			Loaded server-side via <code>loadYarnProject()</code>
			({sources.length}
			{sources.length === 1 ? "source" : "sources"}: {sources.join(", ")}); the compiled program
			crossed the load boundary as a plain serializable object.
		</p>
		{#if diagnostics.length > 0}
			<p>
				Loader diagnostics:
				{#each diagnostics as d, i (i)}{#if i > 0} · {/if}{d.code}: {d.message}{/each}
			</p>
		{/if}
	</header>

	<div aria-live="polite">
		{#each host.transcript.lines as line, i (i)}
			<p>
				{#if line.speaker}<strong>{line.speaker}</strong>{/if}
				<span>{line.text}</span>
			</p>
		{:else}
			<p>Press Continue to begin.</p>
		{/each}
	</div>

	{#if host.transcript.options !== null}
		<fieldset>
			<legend>Options</legend>
			<div role="group" aria-label="Dialogue options">
				{#each host.transcript.options as option, i (i)}
					<button type="button" onclick={() => onOption(i)}>{option.text}</button>
				{/each}
				<button type="button" onclick={() => onOption(noOptionSelected)}>
					Choose none (noOptionSelected)
				</button>
			</div>
		</fieldset>
	{/if}

	<div>
		<button
			type="button"
			onclick={onContinue}
			disabled={host.dialogue.isComplete || host.dialogue.isWaitingForOptionSelection}
		>
			Continue
		</button>
		<button type="button" onclick={onReset}>Reset (variable-storage reset)</button>
		{#if host.dialogue.isComplete}
			<span aria-live="polite">Dialogue complete — Reset replays from the top.</span>
		{/if}
	</div>

	<section>
		<h2>Story variables</h2>
		{#if Object.keys(host.variables).length === 0}
			<p>
				Continue once to deliver the first batch — variables are seeded by
				<code>{"<<declare>>"}</code>.
			</p>
		{:else}
			{#each Object.entries(host.variables) as [name, value] (name)}
				<span><code>${name}</code> = {String(value)}</span>
			{/each}
		{/if}
	</section>
</main>

<style>
	main {
		max-width: 760px;
		margin: 0 auto;
		padding: 32px 20px 60px;
	}
	header {
		margin-bottom: 20px;
	}
	h1 {
		font-size: 22px;
		margin: 0 0 6px;
		color: #e8eaf2;
	}
	h1 span {
		color: #9aa0b5;
		font-weight: 400;
	}
	header p {
		color: #9aa0b5;
		font-size: 13px;
		margin: 0;
	}
	header p + p {
		color: #e0b050;
		margin-top: 6px;
	}
	[aria-live='polite'] p {
		background-color: #23263a;
		border: 1px solid #43475c;
		border-radius: 8px;
		padding: 14px 18px;
		font-size: 16px;
		line-height: 1.5;
		margin: 0 0 10px;
	}
	strong {
		color: #8fb3ff;
		margin-right: 8px;
	}
	fieldset {
		border: 1px solid #43475c;
		border-radius: 8px;
		padding: 12px 16px 14px;
		margin: 14px 0 0;
	}
	legend {
		color: #e8eaf2;
		font-size: 14px;
		font-weight: 600;
		padding: 0 6px;
	}
	[role='group'] {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	button {
		background-color: #2a2d3e;
		color: #e8eaf2;
		border: 1px solid #43475c;
		border-radius: 6px;
		padding: 8px 14px;
		font-size: 14px;
		cursor: pointer;
		text-align: left;
	}
	button:disabled {
		opacity: 0.45;
		cursor: default;
	}
	main > div:last-of-type {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-top: 16px;
	}
	main > div:last-of-type button:not(:disabled) {
		border-color: #2e7d4f;
	}
	main > div:last-of-type button:first-child:not(:disabled) {
		background-color: #2e7d4f;
		padding: 10px 18px;
	}
	section {
		margin-top: 24px;
	}
	h2 {
		color: #e8eaf2;
		font-size: 15px;
		margin: 0 0 8px;
	}
	section span {
		display: inline-block;
		background-color: #2a2d3e;
		border: 1px solid #43475c;
		border-radius: 999px;
		padding: 4px 12px;
		font-size: 13px;
		color: #c2c5d4;
		margin: 0 6px 6px 0;
	}
	code {
		background-color: #1a1d2c;
		border-radius: 4px;
		padding: 1px 5px;
		font-size: 0.9em;
	}
</style>

<script lang="ts">
	import DialogueHost from "$lib/DialogueHost.svelte";

	let { data } = $props();
</script>

{#if data.ok}
	<DialogueHost
		program={data.program}
		projectName={data.projectName}
		sources={data.sources}
		diagnostics={data.diagnostics}
	/>
{:else}
	<main>
		<h1>Project failed to load</h1>
		<ul>
			{#each data.diagnostics as d, i (i)}
				<li>{d.code}: {d.message}</li>
			{/each}
		</ul>
	</main>
{/if}

<script lang="ts">
  import type { DeckTreeNode } from '../db/decks';
  import DeckTreeRow from './DeckTreeRow.svelte';

  let {
    node,
    onOpen,
    onDelete,
  }: {
    node: DeckTreeNode;
    onOpen: (node: DeckTreeNode) => void;
    onDelete: (node: DeckTreeNode) => void;
  } = $props();

  let expanded = $state(true);
</script>

<li>
  <div class="row">
    {#if node.children.length > 0}
      <button class="toggle" onclick={() => (expanded = !expanded)}>{expanded ? '▾' : '▸'}</button>
    {:else}
      <span class="toggle-spacer"></span>
    {/if}
    <button class="deck-name" onclick={() => onOpen(node)} disabled={node.did === null}>
      {node.segment}
    </button>
    <span class="counts">
      {#if node.newCount > 0}<span class="new">{node.newCount}</span>{/if}
      {#if node.learningCount > 0}<span class="learning">{node.learningCount}</span>{/if}
      {#if node.dueCount > 0}<span class="due">{node.dueCount}</span>{/if}
    </span>
    {#if node.did !== null}
      <button class="delete" onclick={() => onDelete(node)} aria-label="Delete deck">✕</button>
    {/if}
  </div>
  {#if expanded && node.children.length > 0}
    <ul>
      {#each node.children as child (child.fullPath)}
        <DeckTreeRow node={child} {onOpen} {onDelete} />
      {/each}
    </ul>
  {/if}
</li>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0;
  }
  .deck-name {
    flex: 1;
    text-align: left;
    background: none;
    border: none;
    font-size: 1rem;
  }
  .toggle,
  .toggle-spacer {
    width: 1.5rem;
  }
  .counts span {
    display: inline-block;
    min-width: 1.5rem;
    text-align: center;
    border-radius: 0.25rem;
    padding: 0 0.25rem;
    margin-left: 0.25rem;
    font-size: 0.85rem;
  }
  .new {
    background: #4a90d9;
    color: white;
  }
  .learning {
    background: #d9534f;
    color: white;
  }
  .due {
    background: #5cb85c;
    color: white;
  }
  .delete {
    background: none;
    border: none;
    color: #d33;
  }
  ul {
    list-style: none;
    padding-left: 1.5rem;
    margin: 0;
  }
</style>

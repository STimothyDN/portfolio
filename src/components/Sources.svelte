<script>
	import Modal from './Modal.svelte';

	let showModal = false;
</script>

<button on:click={() => (showModal = true)}>
	show sources
</button>

<Modal bind:showModal>
	<h2 slot="header">
		Sources
	</h2>

	<ol class="definition-list">
		<li>​​https://justwomenssports.com/reads/north-carolina-unc-soccer-college-cup-dominance/#:~:text=Of%20the%2040%20national%20championships,total%20Atlantic%20Coast%20Conference%20championships.</li>
		<li>
			https://en.wikipedia.org/wiki/North_Carolina_Tar_Heels_women%27s_soccer
		</li>
		<li>https://goheels.com/news/2022/9/14/womens-soccer-thirty-years-ago-carolina-womens-soccer-conquered-the-impossible.aspx</li>
		<li>https://fanbuzz.com/soccer/unc-womens-soccer-dynasty/</li>
		<li>https://www.ncaa.com/news/soccer-women/article/2020-01-03/womens-soccer-teams-most-ncaa-di-national-championships</li>
		<li>https://goheels.com/sports/2012/8/1/205671583</li>
	</ol>
</Modal>
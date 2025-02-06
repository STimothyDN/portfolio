<template>
    <svg
      ref="svgRef"
      class="responsive-svg"
      :viewBox="`0 0 ${size} ${size}`"
      preserveAspectRatio="xMidYMid meet"
    ></svg>
  </template>
  
  <script setup>
  import { ref, onMounted } from 'vue';
  import * as d3 from 'd3';
  
  const props = defineProps({
    size: { type: Number, default: 800 }
  });
  
  /** Minimal structure for each bracket slot */
  class BracketNode {
    constructor(round, index, team = null) {
      this.round = round; // 1..7
      this.index = index; // slot index
      this.team = team;   // assigned team
    }
  }
  
  /** 
   * buildBracketData(teams):
   *   produces 7 “round” arrays:
   *   Round 1 => 64 arcs, Round 2 => 32 arcs, ... Round 7 => 1 arc
   */
  function buildBracketData(teams) {
    if (teams.length !== 64) {
      throw new Error('Need exactly 64 teams!');
    }
    const rounds = [];
    let roundSize = 64;
    let roundNum = 1;
  
    // Round 1: directly from teams
    let currentNodes = teams.map((t, i) => new BracketNode(roundNum, i, t));
  
    while (roundSize >= 1) {
      rounds.push(currentNodes);
      roundSize = roundSize / 2;
      roundNum++;
      if (roundSize >= 1) {
        currentNodes = d3.range(roundSize).map(i => new BracketNode(roundNum, i));
      }
    }
    return rounds;
  }
  
  // Simple color for unpicked arcs in each ring, alternating grey/white
  function roundFill(rIndex) {
    return (rIndex % 2 === 0) ? '#f0f0f0' : '#e0e0e0';
  }
  
  const svgRef = ref(null);
  const roundArcSelections = [];
  
  onMounted(() => {
    if (!svgRef.value) return;
  
    const svg = d3.select(svgRef.value);
    const center = props.size / 2;
    const margin = 20;
    const maxRadius = center - margin;
    const roundCount = 7;
    const step = maxRadius / roundCount;
  
    // Radii from outer (Round 1) to inner (Round 7)
    const roundRadii = d3.range(roundCount).map(i => maxRadius - i * step);
  
    // Example 64 teams
    const teams = d3.range(64).map(i => ({
      id: i,
      name: `Team ${i + 1}`,
      color: d3.schemeCategory10[i % 10]
    }));
  
    // 7 arrays for the 7 rounds
    const bracketRounds = buildBracketData(teams);
  
    bracketRounds.forEach((roundNodes, rIndex) => {
      const gRound = svg.append('g')
        .attr('transform', `translate(${center}, ${center})`);
  
      const count = roundNodes.length; // 64, 32, 16, 8, 4, 2, 1
      const anglePerSegment = (2 * Math.PI) / count;
  
      // Outer & inner radii for this round
      const outerRadius = roundRadii[rIndex];
      const innerRadius = (rIndex < roundRadii.length - 1)
        ? roundRadii[rIndex + 1]
        : 0;
  
      // Angle for each arc
      roundNodes.forEach((node, i) => {
        node.startAngle = i * anglePerSegment;
        node.endAngle   = (i + 1) * anglePerSegment;
      });
  
      // Arc generator
      const arcGen = d3.arc()
        .innerRadius(innerRadius)
        .outerRadius(outerRadius);
  
      // Draw arcs
      const arcs = gRound.selectAll('path.arc')
        .data(roundNodes)
        .enter()
        .append('path')
        .attr('class', 'arc')
        .attr('d', d => arcGen({
          startAngle: d.startAngle,
          endAngle: d.endAngle
        }))
        .attr('fill', d => {
          // Round 1: color from the team
          if (rIndex === 0) return d.team.color;
          // Later rounds: team color if picked, else ring color
          return d.team && d.team.color ? d.team.color : roundFill(rIndex);
        })
        // White stroke to separate arcs
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .on('click', (evt, d) => pickWinner(d, rIndex));
  
      arcs.append('title')
        .text(d => d.team ? d.team.name : `Round ${d.round} - Slot ${d.index}`);
  
      roundArcSelections.push(arcs);
  
      // Place diamonds ONLY if this round has more than 2 arcs
      // (i.e. skip the final 2‐team matchup).
      if (count > 2) {
        for (let i = 0; i < count; i += 2) {
          const arcA = roundNodes[i];
          const arcB = roundNodes[i + 1];
          if (!arcB) break; // safety check
  
          const boundaryAngle = arcA.endAngle; // same as arcB.startAngle
          const midRadius = (outerRadius + innerRadius) / 2;
  
          const xMid = midRadius * Math.cos(boundaryAngle);
          const yMid = midRadius * Math.sin(boundaryAngle);
  
          const diamond = 9; // half the diamond 'width'
          const pts = [
            [xMid,         yMid - diamond],
            [xMid + diamond, yMid       ],
            [xMid,         yMid + diamond],
            [xMid - diamond, yMid       ]
          ];
  
          gRound.append('polygon')
            .attr('points', pts.map(p => p.join(',')).join(' '))
            .attr('fill', '#ccc')
            .attr('stroke', '#999')
            .attr('stroke-width', 1);
        }
      }
    });
  
    // “Pick winner” => color the next round’s arc
    function pickWinner(clickedNode, rIndex) {
      if (rIndex < bracketRounds.length - 1) {
        const nextRoundNodes = bracketRounds[rIndex + 1];
        const parentIndex = Math.floor(clickedNode.index / 2);
        const parentNode = nextRoundNodes[parentIndex];
        parentNode.team = clickedNode.team;
  
        roundArcSelections[rIndex + 1]
          .filter(d => d.index === parentIndex)
          .attr('fill', clickedNode.team.color);
      }
    }
  });
  </script>
  
  <style scoped>
  .responsive-svg {
    width: 100%;
    height: 100%;
  }
  .arc {
    cursor: pointer;
  }
  </style>
  
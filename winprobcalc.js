function renderWinProbability() {
  // Only show if enabled
  if (!state.showWinProbability) return "";
  
  const { rounds, usTeamName, demTeamName, gameOver } = state;
  if (rounds.length === 0 || gameOver) return "";
  const historicalGames = getLocalStorage("savedGames");
  const winProb = calculateWinProbability(state, historicalGames);
  const labelUs = usTeamName || "Us";
  const labelDem = demTeamName || "Dem";
  return `
    <div id="winProbabilityDisplay" class="text-center text-sm text-gray-600 dark:text-gray-300">
      <span class="inline-block px-4">${labelUs}: ${winProb.us.toFixed(1)}%</span>
      <span class="inline-block px-4">${labelDem}: ${winProb.dem.toFixed(1)}%</span>
    </div>
  `;
}

function calculateWinProbability(currentGame, historicalGames) {
  const { rounds } = currentGame;
  
  if (!rounds || rounds.length === 0) {
    console.log("Win Probabilities: US=50%, DEM=50%");
    console.log("Factors: None - No rounds played");
    return { us: 50, dem: 50, factors: [] };
  }
  
  // Get current scores
  const lastRound = rounds[rounds.length - 1];
  const currentScores = lastRound.runningTotals || { us: 0, dem: 0 };
  const scoreDiff = currentScores.us - currentScores.dem;
  const roundsPlayed = rounds.length;
  
  // Base probability calculation from score difference
  let baseProb = 50 + (scoreDiff / 15);  // Each 12 points is worth 1% advantage
  
  // Adjust for tendency to come back from behind
  let comebackFactor = 0;
  
  // Find similar historical games based on completion status and rounds
  const relevantGames = historicalGames.filter(game => {
    return game.rounds && 
           game.rounds.length > 0 && 
           game.rounds.length >= roundsPlayed && 
           game.finalScore && 
           (game.finalScore.us !== undefined || game.finalScore.dem !== undefined);
  });
  
  // Analyze comebacks in historical games
  if (relevantGames.length > 0) {
    let comebackCount = 0;
    let totalSimilarSituations = 0;
    
    relevantGames.forEach(game => {
      if (!game.rounds || game.rounds.length <= roundsPlayed) return;
      
      const historicalRound = game.rounds[roundsPlayed - 1];
      const finalScores = game.finalScore;
      
      if (!historicalRound || !finalScores) return;
      
      const historicalScores = historicalRound.runningTotals;
      if (!historicalScores) return;
      
      const historicalLeader = historicalScores.us > historicalScores.dem ? "us" : "dem";
      const finalWinner = finalScores.us > finalScores.dem ? "us" : "dem";
      
      if (historicalLeader !== finalWinner) {
        comebackCount++;
      }
      
      totalSimilarSituations++;
    });
    
    if (totalSimilarSituations > 0) {
      const comebackRate = comebackCount / totalSimilarSituations;
      comebackFactor = Math.round(comebackRate * 10); // Max 10% adjustment
    }
  }
  
  // Momentum factor based on recent rounds
  let momentumFactor = 0;
  if (rounds.length >= 3) {
    let recentUsPoints = 0;
    let recentDemPoints = 0;
    
    for (let i = rounds.length - 3; i < rounds.length; i++) {
      if (i >= 0) {
        recentUsPoints += rounds[i].usPoints || 0;
        recentDemPoints += rounds[i].demPoints || 0;
      }
    }
    
    if (recentUsPoints > recentDemPoints) {
      momentumFactor = 2;
    } else if (recentDemPoints > recentUsPoints) {
      momentumFactor = -2;
    }
  }
  
  // Bid strength factor
  let bidStrengthFactor = 0;
  const usHighBids = rounds.filter(r => r.biddingTeam === "us" && r.bidAmount >= 140).length;
  const demHighBids = rounds.filter(r => r.biddingTeam === "dem" && r.bidAmount >= 140).length;
  
  if (usHighBids > demHighBids) {
    bidStrengthFactor = 2;
  } else if (demHighBids > usHighBids) {
    bidStrengthFactor = -2;
  }
  
  // Calculate final probability
  const adjustedProb = Math.min(Math.max(baseProb + momentumFactor + comebackFactor + bidStrengthFactor, 1), 99);
  
  // Factors for explanation
  const factors = [
    { name: "Score Difference", value: Math.round((scoreDiff / 20)), description: `${Math.abs(scoreDiff)} point difference` },
    { name: "Momentum", value: momentumFactor, description: momentumFactor !== 0 ? `Recent rounds trend` : "No clear momentum" },
    { name: "Comeback Tendency", value: comebackFactor, description: `Based on ${relevantGames.length} completed games` },
    { name: "Bid Strength", value: bidStrengthFactor, description: `High bids: us (${usHighBids}), dem (${demHighBids})` }
  ];
  
  // Console output
  console.log(`Win Probabilities: US=${adjustedProb}%, DEM=${100 - adjustedProb}%`);
  console.log("Factors:");
  factors.forEach(factor => {
    console.log(`${factor.name}: ${factor.value}% - ${factor.description}`);
  });
  
  return {
    us: adjustedProb,
    dem: 100 - adjustedProb,
    factors: factors
  };
}

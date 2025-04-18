/// <reference types="@cloudflare/workers-types" />
import { load } from 'cheerio';

interface Env {
    DB: D1Database;
}

interface PlayerStats {
  name: string;
  dotBallsBowled: number;
  dotBallsPlayed: number;
  treesBowling: number; // Trees from dot balls bowled
}

interface TeamStats {
  name: string;
  totalDotBallsBowled: number;
  totalTreesPlanted: number; // Total trees planted by the team
  players: PlayerStats[];
}

interface MatchData {
  timestamp: string;
  teams: TeamStats[];
}

// Team ID to name mapping for IPL teams
const teamNames: Record<string, string> = {
  '17': 'Mumbai Indians',
  '13': 'Chennai Super Kings',
  '19': 'Royal Challengers Bangalore',
  '18': 'Rajasthan Royals',
  '16': 'Kolkata Knight Riders',
  '15': 'Kings XI Punjab',
  '14': 'Delhi Capitals',
  '20': 'Sunrisers Hyderabad',
  '35': 'Gujarat Titans',
  '77': 'Lucknow Super Giants',
};

function extractMatchId(url: string): string {
  // Handle IPL T20 URL format
    const segments = url.split('/');
    return segments[segments.length - 1];
}

function buildJsonUrl(matchId: string): string[] {
  return [
    `https://ipl-stats-sports-mechanic.s3.ap-south-1.amazonaws.com/ipl/feeds/${matchId}-Innings1.js`,
    `https://ipl-stats-sports-mechanic.s3.ap-south-1.amazonaws.com/ipl/feeds/${matchId}-Innings2.js`
  ];
}

async function fetchMatchJson(matchId: string): Promise<any[]> {
  const jsonUrls = buildJsonUrl(matchId);
  console.log('Fetching match data from:', jsonUrls);
  
  const headers = {
    'Accept': 'application/json,text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    'Referer': 'https://www.iplt20.com/',
    'Connection': 'keep-alive',
    'Cache-Control': 'max-age=0',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Upgrade-Insecure-Requests':'1',
    'Pragma': 'no-cache'
  };

  try {
    const responses = await Promise.all(jsonUrls.map(async (url) => {
      try {
        console.log(`Fetching ${url}...`);
        const response = await fetch(url, { headers });
        if (!response.ok) {
          console.error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
          return null; // Return null for failed requests, we'll filter these out later
        }
        
        // Parse the JSONP response to extract the JSON data
        const text = await response.text();
        // Remove the JSONP wrapper (callback function)
        // Expected format: callbackFunction({ ... data ... });
        const jsonMatch = text.match(/^.*?\((.*)\);?\s*$/);
        if (!jsonMatch || !jsonMatch[1]) {
          console.error(`Invalid JSONP format for ${url}`);
          return null;
        }
        
        try {
          return JSON.parse(jsonMatch[1]);
        } catch (parseError) {
          console.error(`JSON parse error for ${url}:`, parseError);
          return null;
        }
      } catch (fetchError) {
        console.error(`Error fetching ${url}:`, fetchError);
        return null;
      }
    }));
    
    // Filter out null responses
    const validResponses = responses.filter(response => response !== null);
    if (validResponses.length === 0) {
      throw new Error(`Failed to fetch any valid data for match ${matchId}`);
    }
    
    return validResponses;
  } catch (error) {
    console.error('Error fetching match data:', error);
    throw error;
  }
}

async function processMatchData(inningsDataArray: any[]): Promise<MatchData> {
  const timestamp = new Date().toISOString();
  const teams: TeamStats[] = [];
  const teamStatsMap = new Map<string, TeamStats>();
  const TREES_PER_DOT_BALL = 18; // Number of trees planted per dot ball

  // Process each innings
  inningsDataArray.forEach((data, inningsIndex) => {
    // Extract data from the correct structure
    const inningsData = inningsIndex === 0 ? data.Innings1 : data.Innings2;
    if (!inningsData) {
      console.log(`No data found for innings ${inningsIndex + 1}`);
      return;
    }

    // Get team information
    const battingTeamId = inningsData.BattingCard?.[0]?.TeamID || `Team${inningsIndex * 2 + 1}`;
    const bowlingTeamId = inningsData.BowlingCard?.[0]?.TeamID || `Team${inningsIndex * 2 + 2}`;
    
    const battingTeam = battingTeamId.toString();
    const bowlingTeam = bowlingTeamId.toString();
    
    // Initialize team data if not exists
    if (!teamStatsMap.has(battingTeam)) {
      teamStatsMap.set(battingTeam, {
        name: battingTeam,
        totalDotBallsBowled: 0,
        totalTreesPlanted: 0,
        players: []
      });
    }
    
    if (!teamStatsMap.has(bowlingTeam)) {
      teamStatsMap.set(bowlingTeam, {
        name: bowlingTeam,
        totalDotBallsBowled: 0,
        totalTreesPlanted: 0,
        players: []
      });
    }
    
    // Process bowlers data
    const bowlersData = inningsData.BowlingCard || [];
    bowlersData.forEach((bowler: any) => {
      const bowlerName = bowler.PlayerShortName || bowler.PlayerName || `Player${bowler.PlayerID}`;
      const dotBalls = parseInt(bowler.DotBalls) || 0;
      const treesPlanted = dotBalls * TREES_PER_DOT_BALL;
      
      // Update team stats
      const team = teamStatsMap.get(bowlingTeam)!;
      team.totalDotBallsBowled += dotBalls;
      team.totalTreesPlanted += treesPlanted;
      
      // Update or add player stats
      const existingPlayer = team.players.find(p => p.name === bowlerName);
      if (existingPlayer) {
        existingPlayer.dotBallsBowled += dotBalls;
        existingPlayer.treesBowling += treesPlanted;
      } else {
        team.players.push({
          name: bowlerName,
          dotBallsBowled: dotBalls,
          dotBallsPlayed: 0,
          treesBowling: treesPlanted
        });
      }
    });
  });
  
  // Convert the map to an array for output
  teamStatsMap.forEach(team => teams.push(team));

  return {
    timestamp,
    teams
  };
}

function calculateDotBallsFromPitchMap(pitchMap: number[][][]): number {
  let dots = 0;
  pitchMap.forEach(row => {
    row.forEach(cell => {
      if (cell[0] === 0) { // First element is runs scored
        dots += cell[2] || 0; // Third element is number of balls
      }
    });
  });
  return dots;
}

async function processMatchUrl(url: string): Promise<MatchData> {
  try {
    const matchId = extractMatchId(url);
    const inningsData = await fetchMatchJson(matchId);
    return await processMatchData(inningsData);
  } catch (error) {
    console.error(`Error processing match URL ${url}:`, error);
    throw error;
  }
}

// Format date as YYYY-MM-DD HH:MM:SS in IST timezone
function formatDateTime(date: Date): string {
  // Convert to IST (UTC+5:30)
  const istDate = new Date(date.getTime() + (5.5 * 60 * 60 * 1000));
  return istDate.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

// Get current date in IST timezone
function getCurrentISTDate(): Date {
  const now = new Date();
  // Convert to IST (UTC+5:30)
  return new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
}


// Get current IST time as a readable string
function getCurrentISTTimeString(): string {
  const istDate = getCurrentISTDate();
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  };
  return new Intl.DateTimeFormat('en-IN', options).format(istDate) + ' IST';
}

// Add this new function to store data
async function storeMatchData(matchData: MatchData, matchUrl: string, db: D1Database): Promise<void> {
    const matchId = extractMatchId(matchUrl);
    const now = getCurrentISTDate(); // Use IST time
    const timestamp = formatDateTime(now);
    const matchDate = formatDateTime(now); // Using IST time
    
    // Store match
    await db.prepare(
      `INSERT OR REPLACE INTO Matches (match_id, match_url, match_date, timestamp) 
       VALUES (?, ?, ?, ?)`
    ).bind(matchId, matchUrl, matchDate, timestamp).run();
    
    // Process each team
    for (const team of matchData.teams) {
      const teamId = team.name;
      const teamName = teamNames[teamId] || teamId;
      
      // Store team if it doesn't exist
      await db.prepare(
        `INSERT OR IGNORE INTO Teams (team_id, team_name) VALUES (?, ?)`
      ).bind(teamId, teamName).run();
      
      // Store team performance
      await db.prepare(
        `INSERT OR REPLACE INTO TeamMatchPerformance 
         (match_id, team_id, total_dot_balls_bowled, total_trees_planted) 
         VALUES (?, ?, ?, ?)`
      ).bind(matchId, teamId, team.totalDotBallsBowled, team.totalTreesPlanted).run();
      
      // Update summary
      await db.prepare(
        `INSERT INTO TreePlantingSummary (team_id, total_trees_planted, last_updated)
         VALUES (?, ?, ?)
         ON CONFLICT(team_id) 
         DO UPDATE SET total_trees_planted = total_trees_planted + ?, 
                       last_updated = ?`
      ).bind(teamId, team.totalTreesPlanted, timestamp, team.totalTreesPlanted, timestamp).run();
      
      // Process players
      for (const player of team.players) {
        const playerId = `${teamId}_${player.name.replace(/\s+/g, '_')}`;
        
        // Store player
        await db.prepare(
          `INSERT OR IGNORE INTO Players (player_id, player_name, team_id) 
           VALUES (?, ?, ?)`
        ).bind(playerId, player.name, teamId).run();
        
        // Store player performance
        await db.prepare(
          `INSERT OR REPLACE INTO PlayerMatchPerformance 
           (match_id, player_id, team_id, dot_balls_bowled, trees_planted) 
           VALUES (?, ?, ?, ?, ?)`
        ).bind(matchId, playerId, teamId, player.dotBallsBowled, player.treesBowling).run();
      }
    }
    
    console.log(`Data for match ${matchId} stored in database`);
  }
  
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`Running scheduled task at: ${getCurrentISTTimeString()}`);

    try {
      const urls = [
        // 'https://www.iplt20.com/match/2025/1799',
        // 'https://www.iplt20.com/match/2025/1800',
        // 'https://www.iplt20.com/match/2025/1801',
        // 'https://www.iplt20.com/match/2025/1802',
        // 'https://www.iplt20.com/match/2025/1803',
        // 'https://www.iplt20.com/match/2025/1804',
        // 'https://www.iplt20.com/match/2025/1805',
        // 'https://www.iplt20.com/match/2025/1806',
        // 'https://www.iplt20.com/match/2025/1807',
        // 'https://www.iplt20.com/match/2025/1808',
        // 'https://www.iplt20.com/match/2025/1809',
        // 'https://www.iplt20.com/match/2025/1810',
        // 'https://www.iplt20.com/match/2025/1811',
        // 'https://www.iplt20.com/match/2025/1812',
        // 'https://www.iplt20.com/match/2025/1813',
        // 'https://www.iplt20.com/match/2025/1814',
        // 'https://www.iplt20.com/match/2025/1815',
        // 'https://www.iplt20.com/match/2025/1816',
        // 'https://www.iplt20.com/match/2025/1817',
        // 'https://www.iplt20.com/match/2025/1818',
        // 'https://www.iplt20.com/match/2025/1819',
        // 'https://www.iplt20.com/match/2025/1820',
        // 'https://www.iplt20.com/match/2025/1821',
        // 'https://www.iplt20.com/match/2025/1822',
        // 'https://www.iplt20.com/match/2025/1823',
        // 'https://www.iplt20.com/match/2025/1824',
        // 'https://www.iplt20.com/match/2025/1825',
        // 'https://www.iplt20.com/match/2025/1826',
        // 'https://www.iplt20.com/match/2025/1827',
        // 'https://www.iplt20.com/match/2025/1828',
        // 'https://www.iplt20.com/match/2025/1829',
        // 'https://www.iplt20.com/match/2025/1830',
        // 'https://www.iplt20.com/match/2025/1831',
        'https://www.iplt20.com/match/2025/1832',
        'https://www.iplt20.com/match/2025/1833',
        'https://www.iplt20.com/match/2025/1834',
        'https://www.iplt20.com/match/2025/1835',
        // 'https://www.iplt20.com/match/2025/1836',
        // 'https://www.iplt20.com/match/2025/1837',
        // 'https://www.iplt20.com/match/2025/1838',
        // 'https://www.iplt20.com/match/2025/1839',
        // 'https://www.iplt20.com/match/2025/1840',
        // 'https://www.iplt20.com/match/2025/1841',
        // 'https://www.iplt20.com/match/2025/1842',
        // 'https://www.iplt20.com/match/2025/1843',
        // 'https://www.iplt20.com/match/2025/1844',
        // 'https://www.iplt20.com/match/2025/1845',
        // 'https://www.iplt20.com/match/2025/1846',
        // 'https://www.iplt20.com/match/2025/1847',
        // 'https://www.iplt20.com/match/2025/1848',
        // 'https://www.iplt20.com/match/2025/1849',
        // 'https://www.iplt20.com/match/2025/1850',
        // 'https://www.iplt20.com/match/2025/1851',
        // 'https://www.iplt20.com/match/2025/1852',
        // 'https://www.iplt20.com/match/2025/1853',
        // 'https://www.iplt20.com/match/2025/1854',
        // 'https://www.iplt20.com/match/2025/1855',
        // 'https://www.iplt20.com/match/2025/1856',
        // 'https://www.iplt20.com/match/2025/1857',
        // 'https://www.iplt20.com/match/2025/1858',
        // 'https://www.iplt20.com/match/2025/1859',
        // 'https://www.iplt20.com/match/2025/1860',
        // 'https://www.iplt20.com/match/2025/1861',
        // 'https://www.iplt20.com/match/2025/1862',
        // 'https://www.iplt20.com/match/2025/1863',
        // 'https://www.iplt20.com/match/2025/1864',
        // 'https://www.iplt20.com/match/2025/1865',
        // 'https://www.iplt20.com/match/2025/1866',
        // 'https://www.iplt20.com/match/2025/1867',
        // 'https://www.iplt20.com/match/2025/1868',
      ];

      // Filter for today's matches
      const processOnlyTodaysMatches = true; // Set to false to process all matches
      
      // Get today's date in IST format YYYY-MM-DD
      const today = getCurrentISTDate().toISOString().split('T')[0];
      console.log(`Today's date (IST): ${today}`);
      
      // Check for matches already processed today
      let processedMatchesToday = 0;
      if (processOnlyTodaysMatches) {
        const result = await env.DB.prepare(
          `SELECT COUNT(*) as count FROM Matches 
           WHERE date(match_date) = date(?)`
        ).bind(formatDateTime(getCurrentISTDate())).all();
        
        if (result.results && result.results.length > 0) {
          processedMatchesToday = (result.results[0] as any).count;
        }
        console.log(`Already processed ${processedMatchesToday} matches today (IST)`);
      }
      
      for (const url of urls) {
        const matchId = extractMatchId(url);
        
        // Skip if we're only processing today's matches and this match was already processed today
        if (processOnlyTodaysMatches) {
          const matchResult = await env.DB.prepare(
            `SELECT match_id FROM Matches 
             WHERE match_id = ? AND date(match_date) = date(?)`
          ).bind(matchId, formatDateTime(getCurrentISTDate())).all();
          
          if (matchResult.results && matchResult.results.length > 0) {
            console.log(`Match ${matchId} was already processed today (IST), skipping...`);
            continue;
          }
        }
        
        console.log(`Processing match: ${url}`);
        const matchData = await processMatchUrl(url);
        
        // Process or store the match data
        console.log(`\n----- Match: ${url} -----`);
        console.log('Match Summary:');
        matchData.teams.forEach(team => {
          const teamName = teamNames[team.name] || team.name;
          console.log(`\n${teamName}:`);
          console.log(`Total Dot Balls Bowled: ${team.totalDotBallsBowled}`);
          console.log(`Total Trees Planted: ${team.totalTreesPlanted} (18 trees per dot ball)`);
          console.log('\nPlayer Statistics:');
          team.players.forEach(player => {
            console.log(`${player.name}:`);
            console.log(`  Dot Balls Bowled: ${player.dotBallsBowled}`);
            console.log(`  Trees Planted: ${player.treesBowling}`);
            if (player.dotBallsPlayed > 0) {
              console.log(`  Dot Balls Played: ${player.dotBallsPlayed}`);
            }
          });
        });

        // Store data in D1
        await storeMatchData(matchData, url, env.DB);
      }
      
      // Print summary of total trees planted
      const totalTreesResult = await env.DB.prepare(
        `SELECT team_id, total_trees_planted FROM TreePlantingSummary ORDER BY total_trees_planted DESC`
      ).all();
      
      console.log("\n===== TOTAL TREES PLANTED =====");
      if (totalTreesResult.results) {
        totalTreesResult.results.forEach((result: any) => {
          const teamName = teamNames[result.team_id] || result.team_id;
          console.log(`${teamName}: ${result.total_trees_planted} trees`);
        });
      }
      
    } catch (error) {
      console.error('Error processing match data:', error);
    }
  },
}; 
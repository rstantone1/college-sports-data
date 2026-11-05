import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles.css';
import { Shell } from './components/Shell';
import { RatingsPage } from './pages/Ratings';
import { TeamPage } from './pages/Team';
import { GamePage } from './pages/Game';
import { MatchupPage } from './pages/Matchup';
import { TodayPage } from './pages/Today';
import { HomePage } from './pages/Home';
import { SportHub } from './pages/SportHub';
import { AllScoresPage } from './pages/AllScores';
import { SchoolPage } from './pages/School';
import { RecordPage } from './pages/Record';
import { BallotPage } from './pages/Ballot';
import { ConferencePage } from './pages/Conference';
import { AboutPage } from './pages/About';
import { TournamentPage } from './pages/Tournament';
import { TransfersPage } from './pages/Transfers';
import { LeadersPage } from './pages/Leaders';
import { PlayerPage } from './pages/Player';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Shell><HomePage /></Shell>} />
        <Route path="/record" element={<Shell><RecordPage /></Shell>} />
        <Route path="/school/:espnId" element={<Shell><SchoolPage /></Shell>} />
        <Route path="/about" element={<Shell><AboutPage /></Shell>} />
        <Route path="/scores" element={<Shell><AllScoresPage /></Shell>} />
        <Route path="/:sport/:season" element={<Shell><SportHub /></Shell>} />
        <Route path="/:sport/:season/rankings" element={<Shell><RatingsPage /></Shell>} />
        <Route path="/:sport/:season/stats" element={<Shell><LeadersPage /></Shell>} />
        <Route path="/:sport/:season/today" element={<Shell><TodayPage /></Shell>} />
        <Route path="/:sport/:season/scores" element={<Shell><TodayPage /></Shell>} />
        <Route path="/:sport/:season/matchup" element={<Shell><MatchupPage /></Shell>} />
        <Route path="/:sport/:season/ballot" element={<Shell><BallotPage /></Shell>} />
        <Route path="/:sport/:season/tournament" element={<Shell><TournamentPage /></Shell>} />
        <Route path="/:sport/:season/transfers" element={<Shell><TransfersPage /></Shell>} />
        <Route path="/:sport/:season/leaders" element={<Shell><LeadersPage /></Shell>} />
        <Route path="/:sport/:season/team/:teamId" element={<Shell><TeamPage /></Shell>} />
        <Route path="/:sport/:season/player/:playerId" element={<Shell><PlayerPage /></Shell>} />
        <Route path="/:sport/:season/game/:gameId" element={<Shell><GamePage /></Shell>} />
        <Route path="/:sport/:season/conf/:confId" element={<Shell><ConferencePage /></Shell>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

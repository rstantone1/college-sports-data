import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles.css';
import { Shell } from './components/Shell';
import { RatingsPage } from './pages/Ratings';
import { TeamPage } from './pages/Team';
import { GamePage } from './pages/Game';
import { MatchupPage } from './pages/Matchup';
import { ScoresPage } from './pages/Scores';
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
        <Route path="/" element={<Navigate to="/mbb/2027" replace />} />
        <Route path="/about" element={<Shell><AboutPage /></Shell>} />
        <Route path="/:sport/:season" element={<Shell><RatingsPage /></Shell>} />
        <Route path="/:sport/:season/scores" element={<Shell><ScoresPage /></Shell>} />
        <Route path="/:sport/:season/matchup" element={<Shell><MatchupPage /></Shell>} />
        <Route path="/:sport/:season/ballot" element={<Shell><BallotPage /></Shell>} />
        <Route path="/:sport/:season/tournament" element={<Shell><TournamentPage /></Shell>} />
        <Route path="/:sport/:season/transfers" element={<Shell><TransfersPage /></Shell>} />
        <Route path="/:sport/:season/leaders" element={<Shell><LeadersPage /></Shell>} />
        <Route path="/:sport/:season/team/:teamId" element={<Shell><TeamPage /></Shell>} />
        <Route path="/:sport/:season/player/:playerId" element={<Shell><PlayerPage /></Shell>} />
        <Route path="/:sport/:season/game/:gameId" element={<Shell><GamePage /></Shell>} />
        <Route path="/:sport/:season/conf/:confId" element={<Shell><ConferencePage /></Shell>} />
        <Route path="*" element={<Navigate to="/mbb/2027" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

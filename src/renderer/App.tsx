import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import RecordPage from './pages/RecordPage';
import RecordingsPage from './pages/RecordingsPage';
import SettingsPage from './pages/SettingsPage';
import OnboardingFlow from './pages/OnboardingFlow';

type Page = 'record' | 'recordings' | 'settings';

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('record');
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [viewRecordingId, setViewRecordingId] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const s = await window.meetingMind.getSettings();
      setSettings(s);
      if (!s.onboardingComplete) {
        setShowOnboarding(true);
      }
    } catch {
      setSettings({});
    }
  }

  function handleOnboardingComplete() {
    setShowOnboarding(false);
    loadSettings();
  }

  function handleRecordingComplete(recordingId: string) {
    setViewRecordingId(recordingId);
    setCurrentPage('recordings');
  }

  function handleNavigate(page: Page) {
    if (page !== 'recordings') {
      setViewRecordingId(null);
    }
    setCurrentPage(page);
  }

  if (showOnboarding) {
    return <OnboardingFlow onComplete={handleOnboardingComplete} />;
  }

  return (
    <div className="app-layout">
      <Sidebar currentPage={currentPage} onNavigate={handleNavigate} />
      <div className="main-content">
        {currentPage === 'record' && <RecordPage onRecordingComplete={handleRecordingComplete} />}
        {currentPage === 'recordings' && <RecordingsPage initialRecordingId={viewRecordingId} />}
        {currentPage === 'settings' && <SettingsPage onSettingsChange={loadSettings} />}
      </div>
    </div>
  );
}

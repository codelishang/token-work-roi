import { createRoot } from 'react-dom/client';
import { App } from './dashboard/App.tsx';
import { ReviewApp } from './review/ReviewApp.tsx';
import { LiveApp } from './live/LiveApp.tsx';

function Root() {
  if (window.location.pathname === '/review') {
    document.title = 'ROI Review · Token Work ROI';
    return <ReviewApp />;
  }
  if (window.location.pathname === '/live') {
    document.title = 'Live Monitor · Token Work ROI';
    return <LiveApp />;
  }
  if (window.location.pathname === '/trust') {
    document.title = 'Local Trust · Token Work ROI';
    return <App routeMode="trust" />;
  }

  document.title = 'Token Work ROI';
  return <App />;
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root is missing.');
}

createRoot(rootElement).render(<Root />);

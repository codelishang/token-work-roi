import { createRoot } from 'react-dom/client';
import { App } from './dashboard/App.jsx';
import { ReviewApp } from './review/ReviewApp.jsx';
import { LiveApp } from './live/LiveApp.jsx';

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

createRoot(document.getElementById('root')).render(<Root />);

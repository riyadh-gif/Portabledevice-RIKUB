import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import { App } from './app.jsx';
import './index.css';

createRoot(document.getElementById('app')).render(<App />);

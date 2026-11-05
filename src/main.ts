import './styles.css';
import { mountApp, type AppHandle } from './ui/app';
import { Store, initialState } from './state';

declare global {
  interface Window {
    /** Test / automation hook. */
    __backdrop?: AppHandle;
  }
}

const root = document.getElementById('app')!;
const store = new Store(initialState(location.search));
window.__backdrop = mountApp(root, store);

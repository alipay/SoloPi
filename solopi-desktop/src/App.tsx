import WorkflowEditor from './components/WorkflowEditor';
import { SharedEmbeddedWebviewProvider } from './components/SharedEmbeddedWebview';

function App() {
  return (
    <div className="w-full h-screen">
      <div className="app-drag-region" />
      <SharedEmbeddedWebviewProvider>
          <WorkflowEditor />
      </SharedEmbeddedWebviewProvider>
    </div>
  );
}

export default App;

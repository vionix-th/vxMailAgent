declare module 'react-dom/client' {
  // Minimal ambient typing to support React 18 style createRoot usage
  type Root = { render: (element: any) => void };
  const ReactDOMClient: {
    createRoot: (container: Element | DocumentFragment) => Root;
  };
  export default ReactDOMClient;
}

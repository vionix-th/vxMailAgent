/// <reference types="vite/client" />

// Allow importing image assets such as PNG from @shared
declare module '*.png' {
  const src: string;
  export default src;
}

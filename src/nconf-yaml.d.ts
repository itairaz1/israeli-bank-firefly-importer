declare module 'nconf-yaml' {
  const format: {
    stringify(obj: unknown, replacer?: unknown, spacing?: unknown): string;
    parse(str: string): unknown;
  };
  export default format;
}

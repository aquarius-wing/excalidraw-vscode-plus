// Desktop (Node) builds register a function that makes sure a local
// excalidraw-room relay is listening. The web build leaves it unset.
export type RelayStarter = (serverUrl: string) => Promise<string | undefined>;
let starter: RelayStarter | undefined;
export const setRelayStarter = (fn: RelayStarter) => {
  starter = fn;
};
export const ensureRelay = (serverUrl: string) =>
  starter ? starter(serverUrl) : Promise.resolve(undefined);

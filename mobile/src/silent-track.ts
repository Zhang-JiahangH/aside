import { NativeModules } from "react-native";
import { MediaStreamTrack } from "react-native-webrtc";

/** Native PCM source, with no microphone capture or permission request. */
export async function createSilentTrack(): Promise<MediaStreamTrack> {
  const info = await NativeModules.AsideAudioSession.createSilentTrack();
  return new MediaStreamTrack(info);
}

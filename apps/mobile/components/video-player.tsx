import { useEffect, useRef } from "react";
import { View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";

interface VideoPlayerProps {
  uri: string;
  startTime?: number;
  playing?: boolean;
}

export function VideoPlayer({ uri, startTime, playing = true }: VideoPlayerProps) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.muted = false;
  });

  const ref = useRef<VideoView>(null);

  useEffect(() => {
    if (startTime !== undefined) {
      player.currentTime = startTime;
    }
    if (playing) {
      player.play();
    } else {
      player.pause();
    }
  }, [uri, startTime, playing]);

  return (
    <View className="w-full aspect-video bg-black">
      <VideoView
        ref={ref}
        player={player}
        style={{ width: "100%", height: "100%" }}
        allowsFullscreen
        allowsPictureInPicture
        nativeControls
      />
    </View>
  );
}

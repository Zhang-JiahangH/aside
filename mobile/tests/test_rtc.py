"""Transport regression: recvonly must not falsely satisfy Live voice acceptance."""
import asyncio
import json
import unittest
from aiortc import AudioStreamTrack, RTCConfiguration, RTCPeerConnection, RTCSessionDescription
import rtc


class LiveClockTest(unittest.IsolatedAsyncioTestCase):
    async def scenario(self, with_input):
        peer = RTCPeerConnection(RTCConfiguration(iceServers=[]))
        if with_input:
            peer.addTrack(AudioStreamTrack())  # synthetic silence, no microphone
        else:
            peer.addTransceiver("audio", direction="recvonly")
        channel = peer.createDataChannel("oai-events")
        ready, answer = asyncio.Event(), asyncio.Event()

        @channel.on("message")
        def receive(raw):
            event = json.loads(raw)
            if event["type"] == "session.started":
                ready.set()
            if event["type"] == "session.output_transcript.delta":
                answer.set()

        try:
            await peer.setLocalDescription(await peer.createOffer())

            class Request:
                async def json(self):
                    return {"transport": {"sdp": peer.localDescription.sdp}}

            response = await rtc.live(Request())
            data = json.loads(response.text)
            await peer.setRemoteDescription(RTCSessionDescription(sdp=data["transport"]["sdp"], type="answer"))
            await asyncio.wait_for(ready.wait(), 5)
            channel.send(json.dumps({"type": "session.commentary.append", "content": "A short answer"}))
            if with_input:
                await asyncio.wait_for(answer.wait(), 3)
            else:
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(answer.wait(), 0.5)
        finally:
            await peer.close()
            await rtc.shutdown(None)

    async def test_recvonly_does_not_generate_answer(self):
        await self.scenario(False)

    async def test_synthetic_silence_generates_answer(self):
        await self.scenario(True)


if __name__ == "__main__":
    unittest.main()

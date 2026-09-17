"""Local synthetic peer: real WebRTC transport, deterministic model output."""
import asyncio
import time
import uuid
import json
from fractions import Fraction

import numpy as np
from aiohttp import web
from aiortc import AudioStreamTrack, RTCConfiguration, RTCPeerConnection, RTCSessionDescription
from av import AudioFrame

peers = set()


class AnswerTrack(AudioStreamTrack):
    def __init__(self):
        super().__init__()
        self.samples = 0
        self.started = None
        self.until = 0

    async def recv(self):
        # ICE setup time must not become a burst of buffered audio on connection.
        if self.started is None:
            self.started = time.monotonic()
        await asyncio.sleep(max(0, self.started + self.samples / 48000 - time.monotonic()))
        count = 960
        positions = (np.arange(count) + self.samples) / 48000
        waveform = np.sin(2 * np.pi * 440 * positions) * 3000
        pcm = (waveform if time.monotonic() < self.until else np.zeros(count)).astype(np.int16)
        frame = AudioFrame.from_ndarray(pcm.reshape(1, -1), format="s16", layout="mono")
        frame.sample_rate = 48000
        frame.pts = self.samples
        frame.time_base = Fraction(1, 48000)
        self.samples += count
        return frame


async def live(request):
    data = await request.json()
    peer = RTCPeerConnection(RTCConfiguration(iceServers=[]))
    peers.add(peer)
    input_ready = asyncio.Event()
    pending = set()

    def spawn(coro):
        task = asyncio.create_task(coro)
        pending.add(task)
        task.add_done_callback(pending.discard)

    @peer.on("track")
    def incoming(audio):
        async def consume():
            try:
                while True:
                    await audio.recv()
                    input_ready.set()
            except Exception:
                pass
        spawn(consume())

    track = AnswerTrack()
    peer.addTrack(track)

    @peer.on("connectionstatechange")
    async def connection_changed():
        if peer.connectionState in ("closed", "failed"):
            for task in tuple(pending):
                task.cancel()
            await peer.close()
            peers.discard(peer)

    @peer.on("datachannel")
    def channel_opened(channel):
        async def ready():
            while channel.readyState == "connecting":
                await asyncio.sleep(0.02)
            if channel.readyState == "open":
                channel.send(json.dumps({"type": "session.started"}))

        asyncio.create_task(ready())

        @channel.on("message")
        def message(raw):
            event = json.loads(raw)
            if event["type"] == "session.commentary.append":
                # Instructions are model input; never echo them into the UI.
                if event["content"] == "A short answer":
                    async def answer():
                        # GPT-Live advances from incoming media, including silence.
                        # A recvonly peer must not falsely pass voice acceptance.
                        await input_ready.wait()
                        if channel.readyState == "open":
                            channel.send(json.dumps({"type": "session.output_transcript.delta", "delta": event["content"]}))
                            track.until = time.monotonic() + 2
                    spawn(answer())
            elif event["type"] == "session.close":
                channel.send(json.dumps({"type": "session.closed"}))
                asyncio.create_task(peer.close())
            elif event["type"] == "session.instructions.append":
                track.until = 0

    await peer.setRemoteDescription(RTCSessionDescription(sdp=data["transport"]["sdp"], type="offer"))
    await peer.setLocalDescription(await peer.createAnswer())
    return web.json_response({"session": {"id": str(uuid.uuid4())}, "transport": {"sdp": peer.localDescription.sdp}})


async def shutdown(_app):
    await asyncio.gather(*(peer.close() for peer in tuple(peers)))


app = web.Application()
app.router.add_post("/live", live)
app.on_shutdown.append(shutdown)
if __name__ == "__main__":
    web.run_app(app, host="127.0.0.1", port=4312)

#import "AsideSilentAudioDevice.h"
#import <AVFoundation/AVFoundation.h>
#import <WebRTCModuleOptions.h>
#import <UIKit/UIKit.h>

@interface AsideSilentAudioDevice ()
@property(nonatomic, strong) id<RTCAudioDeviceDelegate> delegate;
@property(nonatomic, strong) AVAudioEngine *engine;
@property(nonatomic, strong) AVAudioSourceNode *source;
@property(nonatomic, strong) id configurationObserver;
@property(nonatomic, strong) NSMutableArray *interruptObservers;
@property(atomic) BOOL allowed;
@property(atomic) BOOL playing;
@property(atomic) BOOL recording;
@end

@implementation AsideSilentAudioDevice
+ (instancetype)shared {
  static AsideSilentAudioDevice *device;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ device = [AsideSilentAudioDevice new]; });
  return device;
}
+ (void)load {
  // Must precede WebRTCModule's peer-connection factory initialization.
  [WebRTCModuleOptions sharedInstance].audioDevice = [self shared];
}
- (double)deviceInputSampleRate { return 48000; }
- (double)deviceOutputSampleRate { return 48000; }
- (NSTimeInterval)inputIOBufferDuration { return 0.01; }
- (NSTimeInterval)outputIOBufferDuration { return 0.01; }
- (NSInteger)inputNumberOfChannels { return 1; }
- (NSInteger)outputNumberOfChannels { return 1; }
- (NSTimeInterval)inputLatency { return 0; }
- (NSTimeInterval)outputLatency { return [AVAudioSession sharedInstance].outputLatency; }
- (BOOL)isInitialized { return self.delegate != nil; }
- (BOOL)isPlayoutInitialized { return self.isInitialized; }
- (BOOL)isRecordingInitialized { return self.isInitialized; }
- (BOOL)isPlaying { return self.playing; }
- (BOOL)isRecording { return self.recording; }
- (BOOL)initializePlayout { return YES; }
- (BOOL)initializeRecording { return YES; }

- (BOOL)initializeWithDelegate:(id<RTCAudioDeviceDelegate>)delegate {
  self.delegate = delegate;
  self.engine = [AVAudioEngine new];
  AVAudioFormat *format = [[AVAudioFormat alloc] initStandardFormatWithSampleRate:48000 channels:1];
  __weak AsideSilentAudioDevice *weakSelf = self;
  self.source = [[AVAudioSourceNode alloc] initWithFormat:format renderBlock:
    ^OSStatus(BOOL *silence, const AudioTimeStamp *timestamp, AVAudioFrameCount count, AudioBufferList *output) {
      AsideSilentAudioDevice *device = weakSelf;
      // AVAudioEngine supplies the pacing; no JS timers and no capture device.
      SInt16 pcm[8192] = {0};
      if (count > 8192) return kAudioUnitErr_TooManyFramesToProcess;
      AudioBufferList buffer = { .mNumberBuffers = 1,
        .mBuffers = {{ .mNumberChannels = 1, .mDataByteSize = count * sizeof(SInt16), .mData = pcm }} };
      AudioUnitRenderActionFlags flags = 0;
      id<RTCAudioDeviceDelegate> target = device.delegate;
      if (device.allowed && device.recording && target)
        target.deliverRecordedData(&flags, timestamp, 0, count, &buffer, NULL, nil);
      if (device.allowed && device.playing && target)
        target.getPlayoutData(&flags, timestamp, 0, count, &buffer);
      for (UInt32 channel = 0; channel < output->mNumberBuffers; channel++) {
        float *samples = output->mBuffers[channel].mData;
        for (UInt32 i = 0; i < count; i++) samples[i] = pcm[i] / 32768.0f;
      }
      *silence = !device.playing;
      return noErr;
    }];
  [self.engine attachNode:self.source];
  [self.engine connect:self.source to:self.engine.mainMixerNode format:format];
  self.configurationObserver = [[NSNotificationCenter defaultCenter]
    addObserverForName:AVAudioEngineConfigurationChangeNotification object:self.engine queue:nil
    usingBlock:^(NSNotification *note) {
      AsideSilentAudioDevice *device = weakSelf;
      [device.delegate dispatchAsync:^{
        [device.delegate notifyAudioInputInterrupted];
        [device.delegate notifyAudioOutputInterrupted];
        if (device.allowed && (device.playing || device.recording))
          [device.engine startAndReturnError:nil];
      }];
    }];
  self.interruptObservers = [NSMutableArray new];
  for (NSString *name in @[AVAudioSessionInterruptionNotification,
                           AVAudioSessionRouteChangeNotification,
                           UIApplicationDidEnterBackgroundNotification]) {
    id observer = [[NSNotificationCenter defaultCenter] addObserverForName:name object:nil queue:nil
      usingBlock:^(NSNotification *note) {
        BOOL interruption = [name isEqual:AVAudioSessionInterruptionNotification] &&
          [note.userInfo[AVAudioSessionInterruptionTypeKey] unsignedIntegerValue] == AVAudioSessionInterruptionTypeBegan;
        BOOL unplugged = [name isEqual:AVAudioSessionRouteChangeNotification] &&
          [note.userInfo[AVAudioSessionRouteChangeReasonKey] unsignedIntegerValue] == AVAudioSessionRouteChangeReasonOldDeviceUnavailable;
        BOOL background = [name isEqual:UIApplicationDidEnterBackgroundNotification];
        if (!interruption && !unplugged && !background) return;
        AsideSilentAudioDevice *device = weakSelf;
        if (!device.allowed) return;
        [device setAnswerEnabled:NO error:nil];
        // AppState handles background cancellation. Route/call changes also
        // need to cancel the JS question and hold the podcast at its anchor.
        if (!background) dispatch_async(dispatch_get_main_queue(), ^{
          [[NSNotificationCenter defaultCenter] postNotificationName:@"AsideAnswerInterrupted" object:nil];
        });
      }];
    [self.interruptObservers addObject:observer];
  }
  return YES;
}
- (BOOL)updateEngine:(NSError **)error {
  if (self.allowed && (self.playing || self.recording)) {
    if (!self.engine.isRunning) return [self.engine startAndReturnError:error];
  } else {
    [self.engine stop];
    [self.delegate notifyAudioInputInterrupted];
    [self.delegate notifyAudioOutputInterrupted];
  }
  return YES;
}
- (BOOL)setAnswerEnabled:(BOOL)enabled error:(NSError **)error {
  __block BOOL success = YES;
  __block NSError *failure;
  if (self.delegate) {
    [self.delegate dispatchSync:^{
      self.allowed = enabled;
      success = [self updateEngine:&failure];
    }];
  } else self.allowed = enabled;
  if (error) *error = failure;
  return success;
}
- (BOOL)startPlayout { self.playing = YES; return [self updateEngine:nil]; }
- (BOOL)stopPlayout { self.playing = NO; return [self updateEngine:nil]; }
- (BOOL)startRecording { self.recording = YES; return [self updateEngine:nil]; }
- (BOOL)stopRecording { self.recording = NO; return [self updateEngine:nil]; }
- (BOOL)terminateDevice {
  self.playing = NO; self.recording = NO;
  [self.engine stop];
  if (self.configurationObserver) [[NSNotificationCenter defaultCenter] removeObserver:self.configurationObserver];
  for (id observer in self.interruptObservers) [[NSNotificationCenter defaultCenter] removeObserver:observer];
  self.interruptObservers = nil;
  self.configurationObserver = nil;
  self.source = nil; self.engine = nil; self.delegate = nil;
  return YES;
}
@end

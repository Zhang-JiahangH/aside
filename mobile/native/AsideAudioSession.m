#import <React/RCTBridgeModule.h>
#import <React/RCTBridge.h>
#import <React/RCTEventEmitter.h>
#import <WebRTCModule.h>
#import "AsideSilentAudioDevice.h"

// Expo owns podcast playback/recording. WebRTC may run its audio unit only
// while the serialized JS audio coordinator has granted answer playback.
@interface AsideAudioSession : RCTEventEmitter <RCTBridgeModule>
@end

@implementation AsideAudioSession
RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (NSArray<NSString *> *)supportedEvents { return @[@"AsideAnswerInterrupted"]; }
- (void)startObserving {
  [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(interrupted:)
    name:@"AsideAnswerInterrupted" object:nil];
}
- (void)stopObserving { [[NSNotificationCenter defaultCenter] removeObserver:self]; }
- (void)interrupted:(NSNotification *)notification {
  [self sendEventWithName:@"AsideAnswerInterrupted" body:nil];
}

RCT_EXPORT_METHOD(setAnswerEnabled:(BOOL)enabled
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
  NSError *error;
  if (![[AsideSilentAudioDevice shared] setAnswerEnabled:enabled error:&error]) {
    reject(@"answer_audio", @"Couldn't start answer playback", error);
    return;
  }
  resolve(nil);
}

RCT_EXPORT_METHOD(createSilentTrack:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
  WebRTCModule *module = [self.bridge moduleForClass:[WebRTCModule class]];
  if (!module) {
    reject(@"silent_track", @"WebRTC is unavailable", nil);
    return;
  }
  dispatch_async(module.workerQueue, ^{
    NSString *trackId = NSUUID.UUID.UUIDString;
    RTCAudioTrack *track = [module.peerConnectionFactory audioTrackWithTrackId:trackId];
    module.localTracks[trackId] = track;
    resolve(@{ @"id": trackId, @"kind": @"audio", @"enabled": @YES,
      @"remote": @NO, @"readyState": @"live", @"constraints": @{},
      @"settings": @{}, @"peerConnectionId": @(-1) });
  });
}
@end

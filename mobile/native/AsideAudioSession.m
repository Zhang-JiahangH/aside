#import <React/RCTBridgeModule.h>
#import <WebRTC/RTCAudioSession.h>
#import <WebRTC/RTCAudioSessionConfiguration.h>

// Expo owns podcast playback/recording. WebRTC may run its audio unit only
// while the serialized JS audio coordinator has granted answer playback.
@interface AsideAudioSession : NSObject <RCTBridgeModule>
@end

@implementation AsideAudioSession
RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }

RCT_EXPORT_METHOD(setAnswerEnabled:(BOOL)enabled
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
  RTCAudioSession *session = [RTCAudioSession sharedInstance];
  session.useManualAudio = YES;
  if (enabled) {
    RTCAudioSessionConfiguration *configuration = [RTCAudioSessionConfiguration webRTCConfiguration];
    configuration.categoryOptions |= AVAudioSessionCategoryOptionDefaultToSpeaker;
    [RTCAudioSessionConfiguration setWebRTCConfiguration:configuration];
  }
  session.isAudioEnabled = enabled;
  resolve(nil);
}
@end

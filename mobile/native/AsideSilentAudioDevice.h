#import <WebRTC/RTCAudioDevice.h>

// Live needs an input media clock even for text-driven speech. This device
// renders remote audio and supplies zero PCM; it never opens a microphone.
@interface AsideSilentAudioDevice : NSObject <RTCAudioDevice>
+ (instancetype)shared;
- (BOOL)setAnswerEnabled:(BOOL)enabled error:(NSError **)error;
@end

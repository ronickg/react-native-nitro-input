//
//  NitroInputCommands.mm
//  NitroInput
//
//  React Native dispatches `focus` and `blur` to a text input as Fabric view
//  *commands* (`TextInputState.focusTextInput` / `blurTextInput`, and therefore
//  `Keyboard.dismiss()`, `keyboardShouldPersistTaps` and a ScrollView's
//  auto-blur). Nitrogen's generated component view does not implement
//  `handleCommand:args:`, so those commands used to be dropped and the keyboard
//  stayed up. This category adds the handler without touching generated code.
//

#import <React/RCTViewComponentView.h>
#import <UIKit/UIKit.h>

@interface HybridNitroInputViewComponent : RCTViewComponentView
@end

/// The hidden system field NitroInputView keeps as its only subview.
static UITextField *NitroInputFindField(UIView *view)
{
  if ([view isKindOfClass:[UITextField class]]) {
    return (UITextField *)view;
  }
  for (UIView *subview in view.subviews) {
    UITextField *field = NitroInputFindField(subview);
    if (field != nil) {
      return field;
    }
  }
  return nil;
}

@implementation HybridNitroInputViewComponent (NitroInputCommands)

- (void)handleCommand:(const NSString *)commandName args:(const NSArray *)args
{
  UITextField *field = NitroInputFindField(self.contentView);
  if (field == nil) {
    return;
  }
  if ([(NSString *)commandName isEqualToString:@"focus"]) {
    // `isEnabled` mirrors the `editable` prop, so a read-only field declines.
    if (field.isEnabled) {
      [field becomeFirstResponder];
    }
  } else if ([(NSString *)commandName isEqualToString:@"blur"]) {
    [field resignFirstResponder];
  }
}

@end

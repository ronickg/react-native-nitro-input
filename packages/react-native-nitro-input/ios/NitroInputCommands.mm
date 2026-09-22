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

/// The system editor NitroInputView keeps as a subview: a `UITextField`, or a
/// `UITextView` once the field wraps (`multiline`). The view keeps both around
/// and shows one, so the hidden one is passed over.
static UIView *NitroInputFindEditor(UIView *view)
{
  if ([view isKindOfClass:[UITextField class]] || [view isKindOfClass:[UITextView class]]) {
    return view.isHidden ? nil : view;
  }
  for (UIView *subview in view.subviews) {
    UIView *editor = NitroInputFindEditor(subview);
    if (editor != nil) {
      return editor;
    }
  }
  return nil;
}

/// Mirrors the `editable` prop: `isEnabled` on a text field, `isEditable` on
/// a text view. A read-only field declines focus either way.
static BOOL NitroInputEditorIsEditable(UIView *editor)
{
  if ([editor isKindOfClass:[UITextField class]]) {
    return ((UITextField *)editor).isEnabled;
  }
  if ([editor isKindOfClass:[UITextView class]]) {
    return ((UITextView *)editor).isEditable;
  }
  return NO;
}

@implementation HybridNitroInputViewComponent (NitroInputCommands)

- (void)handleCommand:(const NSString *)commandName args:(const NSArray *)args
{
  UIView *editor = NitroInputFindEditor(self.contentView);
  if (editor == nil) {
    return;
  }
  if ([(NSString *)commandName isEqualToString:@"focus"]) {
    if (NitroInputEditorIsEditable(editor)) {
      [editor becomeFirstResponder];
    }
  } else if ([(NSString *)commandName isEqualToString:@"blur"]) {
    [editor resignFirstResponder];
  }
}

@end

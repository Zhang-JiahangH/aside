import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { z } from "zod";

type Colors = {
  text: string;
  muted: string;
  accent: string;
  onAccent: string;
  surface: string;
  line: string;
};
export function LoginForm({
  locale,
  colors,
  sendCode,
  signIn,
}: {
  locale: string;
  colors: Colors;
  sendCode(email: string): Promise<unknown>;
  signIn(email: string, code: string): Promise<void>;
}) {
  const tr = (zh: string, en: string) => (locale === "zh" ? zh : en);
  const [email, setEmail] = useState("");
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"send" | "verify" | null>(null);
  const [now, setNow] = useState(Date.now());
  const [deadline, setDeadline] = useState(0);
  const pending = useRef(false);
  const mounted = useRef(true);
  const sentAt = useRef(new Map<string, number>());
  const codeInput = useRef<TextInput>(null);
  const normalizedEmail = email.trim().toLowerCase();
  const validEmail = z
    .string()
    .email()
    .max(254)
    .safeParse(normalizedEmail).success;
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!remaining) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [deadline, remaining > 0]);
  useEffect(() => {
    if (sentEmail) codeInput.current?.focus();
  }, [sentEmail]);

  function describe(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/Network request failed|Failed to fetch|NetworkError/i.test(message))
      return tr(
        "暂时无法连接，请检查网络后重试。",
        "Unable to connect. Check your connection and try again.",
      );
    if (/验证码无效|已过期/.test(message))
      return tr(
        "验证码有误或已过期，请检查邮件或重新获取。",
        "The code is incorrect or expired. Check your email or request a new code.",
      );
    if (/邮件暂时无法发送/.test(message))
      return tr(
        "邮件暂时无法发送，请稍后重试。",
        "We couldn’t send the email. Please try again shortly.",
      );
    if (
      cause &&
      typeof cause === "object" &&
      "status" in cause &&
      cause.status === 429
    )
      return tr(
        "请求较频繁，请稍后再试。",
        "Too many attempts. Please try again later.",
      );
    return tr(
      "暂时无法登录，请稍后重试。",
      "We couldn’t sign you in. Please try again shortly.",
    );
  }
  async function perform(kind: "send" | "verify") {
    if (pending.current) return;
    if (kind === "send" && (!validEmail || remaining)) return;
    if (kind === "verify" && (!sentEmail || !/^\d{8}$/.test(code))) return;
    pending.current = true;
    setBusy(kind);
    setError("");
    Keyboard.dismiss();
    try {
      if (kind === "send") {
        await sendCode(normalizedEmail);
        if (!mounted.current) return;
        const until = Date.now() + 60000;
        sentAt.current.set(normalizedEmail, until);
        setNow(Date.now());
        setDeadline(until);
        setCode("");
        setSentEmail(normalizedEmail);
      } else {
        await signIn(sentEmail!, code);
      }
    } catch (cause) {
      if (mounted.current) setError(describe(cause));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  const fieldStyle = {
    color: colors.text,
    borderColor: colors.line,
    borderWidth: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
  };
  function action(
    label: string,
    id: string,
    onPress: () => void,
    disabled = false,
    secondary = false,
    spinning = false,
  ) {
    return (
      <Pressable
        testID={id}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled, busy: spinning }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => ({
          minHeight: 52,
          borderRadius: 14,
          padding: 14,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.5 : pressed ? 0.65 : 1,
          backgroundColor: secondary ? "transparent" : colors.accent,
        })}
      >
        {spinning ? (
          <ActivityIndicator
            color={secondary ? colors.accent : colors.onAccent}
          />
        ) : (
          <Text
            maxFontSizeMultiplier={1.5}
            style={{
              color: secondary ? colors.accent : colors.onAccent,
              fontSize: 16,
              fontWeight: "600",
            }}
          >
            {label}
          </Text>
        )}
      </Pressable>
    );
  }
  return (
    <View style={{ gap: 20, paddingTop: 8 }}>
      <View style={{ gap: 10 }}>
        {sentEmail ? (
          <Text style={{ color: colors.text, fontSize: 23, fontWeight: "600" }}>
            {tr("查看你的邮箱", "Check your inbox")}
          </Text>
        ) : null}
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 23 }}>
          {sentEmail
            ? tr(
                `验证码已发送至 ${sentEmail}，10 分钟内有效。`,
                `We sent a code to ${sentEmail}. It’s valid for 10 minutes.`,
              )
            : tr(
                "使用与网站相同的邮箱，继续收听、上传和提问。",
                "Use your website email to access your audio, progress and conversations.",
              )}
        </Text>
      </View>
      {!sentEmail ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.muted, fontSize: 13 }}>
            {tr("邮箱地址", "Email address")}
          </Text>
          <TextInput
            testID="email"
            accessibilityLabel={tr("邮箱地址", "Email address")}
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              setError("");
              setDeadline(sentAt.current.get(value.trim().toLowerCase()) ?? 0);
              setNow(Date.now());
            }}
            editable={!busy}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="go"
            onSubmitEditing={() => {
              void perform("send");
            }}
            placeholder="name@example.com"
            placeholderTextColor={colors.muted}
            style={fieldStyle}
            maxFontSizeMultiplier={1.5}
          />
        </View>
      ) : (
        <TextInput
          ref={codeInput}
          testID="code"
          accessibilityLabel={tr("8 位验证码", "8-digit verification code")}
          value={code}
          onChangeText={(value) => {
            const digits = value.replace(/\D/g, "").slice(0, 8);
            setCode(digits);
            setError("");
            if (digits.length === 8) Keyboard.dismiss();
          }}
          editable={!busy}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          keyboardType="number-pad"
          inputAccessoryViewID="verification-keyboard"
          maxLength={8}
          placeholder={tr("8 位验证码", "8-digit code")}
          placeholderTextColor={colors.muted}
          style={[fieldStyle, { fontSize: 24, letterSpacing: 5 }]}
          maxFontSizeMultiplier={1.5}
        />
      )}
      {error ? (
        <Text
          testID="login-error"
          accessibilityRole="alert"
          style={{ color: colors.text, lineHeight: 22 }}
        >
          {error}
        </Text>
      ) : null}
      <View style={{ gap: 4 }}>
        {sentEmail
          ? action(
              tr("登录", "Sign in"),
              "sign-in",
              () => {
                void perform("verify");
              },
              Boolean(busy) || code.length !== 8,
              false,
              busy === "verify",
            )
          : null}
        {action(
          remaining
            ? tr(`${remaining} 秒后可重新发送`, `Resend in ${remaining}s`)
            : sentEmail
              ? tr("重新发送验证码", "Resend code")
              : tr("发送验证码", "Send code"),
          "send-code",
          () => {
            void perform("send");
          },
          Boolean(busy) || remaining > 0 || !validEmail,
          Boolean(sentEmail),
          busy === "send",
        )}
        {sentEmail
          ? action(
              tr("更换邮箱", "Use a different email"),
              "change-email",
              () => {
                setSentEmail(null);
                setCode("");
                setError("");
              },
              Boolean(busy),
              true,
            )
          : null}
      </View>
      <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 20 }}>
        {sentEmail
          ? tr(
              "没有收到？请检查垃圾邮件，或稍后重新发送。",
              "No email? Check your spam folder, or resend the code shortly.",
            )
          : tr(
              "无需设置密码。首次登录会自动创建账号。",
              "No password needed. Your first sign-in creates an account.",
            )}
      </Text>
    </View>
  );
}

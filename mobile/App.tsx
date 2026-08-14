import { ClerkProvider, useAuth, useSSO, useUser } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  AccountMe,
  ApiError,
  Audit,
  ImportResult,
  apiRequest,
  importQuote,
  randomSessionId,
  sendFeedback,
} from "./src/api";

WebBrowser.maybeCompleteAuthSession();

const CLERK_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
const colors = {
  navy: "#061126",
  panel: "#0b1b38",
  panelStrong: "#102647",
  gold: "#f6c343",
  text: "#f5f7fb",
  muted: "#cbd5e1",
  soft: "#9eafc8",
  border: "#2c456b",
  danger: "#ffb4ab",
};

type Screen = "home" | "review" | "survey" | "audits" | "account";

const fieldLabel = (key: string) => key
  .replace(/([A-Z])/g, " $1")
  .replace(/^./, (letter) => letter.toUpperCase());

const formatDate = (value: number | null | undefined) => {
  if (!value) return "Not available";
  return new Date(value * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatValue = (value: string | number) => {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return value;
};

const errorMessage = (error: unknown) => {
  if (error instanceof ApiError) {
    if (error.code === "AI_IMPORT_NOT_CONFIGURED") return "Quote scanning is temporarily unavailable. Please try again shortly.";
    if (error.code === "AI_IMPORT_TOO_LARGE") return "That file is too large. Choose a smaller photo or PDF.";
    if (error.code === "invalid_account_session") return "Your sign-in session needs to be refreshed. Please sign in again.";
    if (error.code === "stripe_product_ineligible") return "Checkout is not available for this item yet. Please contact support.";
    return `PencilProof could not complete that request (${error.code}).`;
  }
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
};

const Button = ({
  children,
  onPress,
  secondary = false,
  disabled = false,
}: {
  children: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) => (
  <Pressable
    accessibilityRole="button"
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [
      styles.button,
      secondary && styles.buttonSecondary,
      disabled && styles.buttonDisabled,
      pressed && !disabled && styles.buttonPressed,
    ]}
  >
    <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{children}</Text>
  </Pressable>
);

const SectionTitle = ({ eyebrow, title, body }: { eyebrow?: string; title: string; body?: string }) => (
  <View style={styles.titleBlock}>
    {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
    <Text style={styles.title}>{title}</Text>
    {body ? <Text style={styles.body}>{body}</Text> : null}
  </View>
);

const LoginButtons = ({ onLogin, busy }: { onLogin: (strategy: "oauth_google" | "oauth_apple") => void; busy: boolean }) => (
  <View style={styles.stack}>
    <Button disabled={busy} onPress={() => onLogin("oauth_google")}>Continue with Google</Button>
    <Button disabled={busy} onPress={() => onLogin("oauth_apple")} secondary>Continue with Apple</Button>
    <Text style={styles.helper}>Apple sign-in will become available as soon as Apple and Clerk finish activating the provider.</Text>
  </View>
);

function PencilProofApp() {
  const { getToken, isSignedIn, signOut } = useAuth();
  const { startSSOFlow } = useSSO();
  const { user } = useUser();
  const [screen, setScreen] = useState<Screen>("home");
  const [quote, setQuote] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loginError, setLoginError] = useState("");
  const [audits, setAudits] = useState<Audit[]>([]);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [surveyRating, setSurveyRating] = useState(5);
  const [surveyWorth, setSurveyWorth] = useState("30-39.99");
  const [surveyComment, setSurveyComment] = useState("");
  const [deleteReason, setDeleteReason] = useState("");

  const email = user?.primaryEmailAddress?.emailAddress ?? "";

  const syncAccount = useCallback(async () => {
    const token = await getToken();
    if (!token || !user) return null;
    await apiRequest<{ ok: boolean }>("/api/account/session", {
      method: "POST",
      body: JSON.stringify({ email, token }),
    }, token);
    return token;
  }, [email, getToken, user]);

  const loadAudits = useCallback(async () => {
    if (!isSignedIn) {
      setAudits([]);
      setExpiresAt(null);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const token = await syncAccount();
      if (!token) return;
      const result = await apiRequest<AccountMe>("/api/account/me", {}, token);
      setAudits(result.audits ?? []);
      setExpiresAt(result.expiresAt ?? null);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [isSignedIn, syncAccount]);

  useEffect(() => {
    if (isSignedIn && user) void syncAccount().catch((error) => setMessage(errorMessage(error)));
  }, [isSignedIn, syncAccount, user]);

  const handleLogin = async (strategy: "oauth_google" | "oauth_apple") => {
    setBusy(true);
    setLoginError("");
    try {
      const result = await startSSOFlow({ strategy });
      if (result.createdSessionId) {
        await result.setActive?.({ session: result.createdSessionId });
        setScreen("home");
      } else {
        setLoginError("The sign-in flow did not finish. Please try again.");
      }
    } catch (error) {
      const detail = errorMessage(error);
      setLoginError(strategy === "oauth_apple"
        ? "Apple sign-in is not active in Clerk yet. Google sign-in is ready now."
        : detail);
    } finally {
      setBusy(false);
    }
  };

  const uploadQuote = async (uri: string, mimeType: string) => {
    setBusy(true);
    setMessage("");
    try {
      const result = await importQuote(uri, mimeType, await getToken());
      setQuote(result);
      setScreen("review");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const takePhoto = async () => {
    setMessage("");
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setMessage("Camera access is needed to photograph a quote.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      await uploadQuote(result.assets[0].uri, result.assets[0].mimeType ?? "image/jpeg");
    }
  };

  const chooseFile = async () => {
    setMessage("");
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      type: ["application/pdf", "image/*"],
    });
    if (!result.canceled && result.assets[0]) {
      await uploadQuote(result.assets[0].uri, result.assets[0].mimeType ?? "application/pdf");
    }
  };

  const submitSurveyAndCheckout = async () => {
    setBusy(true);
    setMessage("");
    try {
      const token = await getToken();
      await sendFeedback(
        surveyRating,
        `Worth: ${surveyWorth}${surveyComment.trim() ? ` — ${surveyComment.trim()}` : ""}`,
        "mobile-precheckout",
        token,
      );
      const result = await apiRequest<{ url: string }>("/api/checkout", {
        method: "POST",
        body: JSON.stringify({ analyticsSessionId: randomSessionId() }),
      }, token);
      await Linking.openURL(result.url);
      setMessage(isSignedIn
        ? "Secure checkout is open. After payment, return here and open My Audits."
        : "Secure checkout is open. Sign in before payment if you want the purchase connected to My Audits.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    if (!deleteReason) {
      setMessage("Choose a reason so we can improve PencilProof.");
      return;
    }
    Alert.alert("Delete your account?", "Your saved audits and account data will be removed.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete account",
        style: "destructive",
        onPress: () => void (async () => {
          setBusy(true);
          try {
            const token = await syncAccount();
            if (!token) return;
            await sendFeedback(1, `Account deletion reason: ${deleteReason}`, "account-deletion", token);
            await apiRequest<void>("/api/account/delete", { method: "POST" }, token);
            await signOut();
            setScreen("home");
            setMessage("Your PencilProof account was deleted.");
          } catch (error) {
            setMessage(errorMessage(error));
          } finally {
            setBusy(false);
          }
        })(),
      },
    ]);
  };

  const nav = useMemo(() => (
    <View style={styles.nav}>
      <Pressable onPress={() => setScreen("home")}><Text style={styles.brand}>PencilProof</Text></Pressable>
      <View style={styles.navLinks}>
        {isSignedIn ? <Pressable onPress={() => { setScreen("audits"); void loadAudits(); }}><Text style={styles.navLink}>My Audits</Text></Pressable> : null}
        <Pressable onPress={() => setScreen(isSignedIn ? "account" : "home")}><Text style={styles.navLink}>{isSignedIn ? email || "Account" : "Sign in"}</Text></Pressable>
      </View>
    </View>
  ), [email, isSignedIn, loadAudits]);

  const renderHome = () => (
    <>
      <SectionTitle
        eyebrow="NO SURPRISES"
        title="Know what you are getting before checkout."
        body="Upload a dealer quote, review the numbers PencilProof detected, and see what deserves a closer look before you pay."
      />
      <View style={styles.cardRow}>
        <View style={styles.featureCard}>
          <Text style={styles.cardTitle}>Take a photo</Text>
          <Text style={styles.cardBody}>Use your phone camera for a physical quote. The app sends the image securely for analysis.</Text>
          <Button disabled={busy} onPress={() => void takePhoto()}>Take photo</Button>
        </View>
        <View style={styles.featureCard}>
          <Text style={styles.cardTitle}>Choose PDF or image</Text>
          <Text style={styles.cardBody}>Pick a saved quote from your phone. You can review detected values before checkout.</Text>
          <Button disabled={busy} onPress={() => void chooseFile()}>Choose a file</Button>
        </View>
      </View>
      {!isSignedIn ? (
        <View style={styles.signInCard}>
          <Text style={styles.cardTitle}>Save your PencilProof access</Text>
          <Text style={styles.cardBody}>Sign in to keep paid audits connected across devices and view your audit history.</Text>
          <LoginButtons busy={busy} onLogin={(strategy) => void handleLogin(strategy)} />
        </View>
      ) : (
        <View style={styles.accountStrip}>
          <Text style={styles.cardBody}>Signed in as {email || "your PencilProof account"}.</Text>
          <Button secondary onPress={() => { setScreen("audits"); void loadAudits(); }}>Open My Audits</Button>
        </View>
      )}
    </>
  );

  const renderReview = () => (
    <>
      <SectionTitle eyebrow="REVIEW BEFORE CHECKOUT" title="Confirm the quote values."
        body="PencilProof extracts the visible numbers first. Check them against the quote before continuing." />
      <View style={styles.reviewGrid}>
        {Object.entries(quote?.fields ?? {}).map(([key, value]) => (
          <View key={key} style={styles.valueCard}>
            <Text style={styles.valueLabel}>{fieldLabel(key)}</Text>
            <Text style={styles.value}>{formatValue(value)}</Text>
          </View>
        ))}
      </View>
      {quote?.warnings?.map((warning) => <Text key={warning} style={styles.warning}>Review: {warning}</Text>)}
      {!Object.keys(quote?.fields ?? {}).length ? <Text style={styles.warning}>No confident values were detected. You can still continue, but review the original quote carefully.</Text> : null}
      <View style={styles.actions}>
        <Button disabled={busy} onPress={() => setScreen("survey")}>Confirm values and continue</Button>
        <Button secondary onPress={() => setScreen("home")}>Choose another quote</Button>
      </View>
    </>
  );

  const worthOptions = ["0-9.99", "10-19.99", "20-29.99", "30-39.99", "40+"];
  const renderSurvey = () => (
    <>
      <SectionTitle eyebrow="BEFORE SECURE CHECKOUT" title="Tell us what this service is worth to you."
        body="This short feedback form appears before payment. It helps PencilProof improve without changing your quote results." />
      <View style={styles.surveyCard}>
        <Text style={styles.cardTitle}>How useful was the scan?</Text>
        <View style={styles.optionRow}>
          {[1, 2, 3, 4, 5].map((rating) => (
            <Pressable key={rating} onPress={() => setSurveyRating(rating)} style={[styles.rating, surveyRating === rating && styles.ratingSelected]}>
              <Text style={[styles.ratingText, surveyRating === rating && styles.ratingTextSelected]}>{rating}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.cardTitle}>How much would this service be worth to you?</Text>
        <View style={styles.optionWrap}>
          {worthOptions.map((worth) => (
            <Pressable key={worth} onPress={() => setSurveyWorth(worth)} style={[styles.option, surveyWorth === worth && styles.optionSelected]}>
              <Text style={[styles.optionText, surveyWorth === worth && styles.optionTextSelected]}>${worth}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.cardTitle}>Suggestions</Text>
        <TextInput
          multiline
          onChangeText={setSurveyComment}
          placeholder="What should PencilProof improve?"
          placeholderTextColor={colors.soft}
          style={styles.input}
          value={surveyComment}
        />
        <Button disabled={busy} onPress={() => void submitSurveyAndCheckout()}>Continue to secure checkout</Button>
        <Button secondary onPress={() => setScreen("review")}>Back to review</Button>
      </View>
    </>
  );

  const renderAudits = () => (
    <>
      <SectionTitle eyebrow="MY AUDITS" title="Your saved audit history."
        body={expiresAt ? `Your account access is available through ${formatDate(expiresAt)}.` : "Sign in to see audits connected to this account."} />
      {busy ? <ActivityIndicator color={colors.gold} /> : null}
      {!busy && audits.length === 0 ? <View style={styles.emptyCard}><Text style={styles.cardTitle}>No saved audits yet.</Text><Text style={styles.cardBody}>Complete a paid audit while signed in and it will appear here.</Text><Button onPress={() => setScreen("home")}>Review a quote</Button></View> : null}
      {audits.map((audit) => (
        <View key={audit.id} style={styles.auditCard}>
          <View style={styles.auditHeader}><Text style={styles.cardTitle}>{audit.data?.vehicle || "Vehicle audit"}</Text><Text style={styles.auditDate}>{formatDate(audit.createdAt)}</Text></View>
          <Text style={styles.cardBody}>{audit.data?.verdict || "Audit available"}</Text>
          <Text style={styles.auditExpiry}>Available through {formatDate(audit.expiresAt)}</Text>
        </View>
      ))}
    </>
  );

  const renderAccount = () => {
    const reasons = ["Price too high", "I bought a different car", "I no longer need the service", "Something did not work", "Other"];
    return (
      <>
        <SectionTitle eyebrow="ACCOUNT" title="Your PencilProof account."
          body={`Signed in as ${email || "your verified account"}.`} />
        <View style={styles.accountCard}>
          <Text style={styles.cardTitle}>Account access</Text>
          <Text style={styles.cardBody}>Use My Audits to view saved purchase history. Sign out here when using a shared device.</Text>
          <Button secondary onPress={() => void signOut()}>Sign out</Button>
        </View>
        <View style={styles.accountCard}>
          <Text style={styles.cardTitle}>Delete my account</Text>
          <Text style={styles.cardBody}>Tell us why before deletion. Your response is recorded without keeping your account.</Text>
          <View style={styles.optionWrap}>
            {reasons.map((reason) => (
              <Pressable key={reason} onPress={() => setDeleteReason(reason)} style={[styles.option, deleteReason === reason && styles.optionSelected]}>
                <Text style={[styles.optionText, deleteReason === reason && styles.optionTextSelected]}>{reason}</Text>
              </Pressable>
            ))}
          </View>
          <Button disabled={busy} onPress={() => void deleteAccount()}>Delete my account</Button>
        </View>
      </>
    );
  };

  let content = renderHome();
  if (screen === "review") content = renderReview();
  if (screen === "survey") content = renderSurvey();
  if (screen === "audits") content = renderAudits();
  if (screen === "account") content = isSignedIn ? renderAccount() : renderHome();

  return (
    <SafeAreaView style={styles.safe}>
      {nav}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {content}
        {loginError ? <Text style={styles.error}>{loginError}</Text> : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {busy && screen !== "audits" ? <ActivityIndicator color={colors.gold} style={styles.loader} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const MissingConfig = () => (
  <SafeAreaView style={styles.safe}>
    <View style={styles.content}>
      <SectionTitle eyebrow="SETUP REQUIRED" title="Connect PencilProof sign-in."
        body="Add EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to the mobile environment before running the app." />
    </View>
  </SafeAreaView>
);

export default function App() {
  if (!CLERK_KEY) return <SafeAreaProvider><MissingConfig /></SafeAreaProvider>;
  return (
    <ClerkProvider publishableKey={CLERK_KEY} tokenCache={tokenCache}>
      <SafeAreaProvider><PencilProofApp /></SafeAreaProvider>
    </ClerkProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.navy },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  brand: { color: colors.text, fontSize: 21, fontWeight: "800" },
  navLinks: { flexDirection: "row", alignItems: "center", gap: 18 },
  navLink: { color: colors.gold, fontSize: 13, fontWeight: "700" },
  content: { padding: 20, paddingBottom: 56, gap: 18 },
  titleBlock: { gap: 10, marginBottom: 4 },
  eyebrow: { color: colors.gold, fontSize: 12, fontWeight: "800", letterSpacing: 1.5 },
  title: { color: colors.text, fontSize: 36, lineHeight: 42, fontWeight: "800", letterSpacing: -0.7 },
  body: { color: colors.muted, fontSize: 16, lineHeight: 24 },
  cardRow: { gap: 14 },
  featureCard: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 18, gap: 12 },
  signInCard: { backgroundColor: colors.panelStrong, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 18, gap: 12 },
  accountStrip: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 18, gap: 12 },
  cardTitle: { color: colors.text, fontSize: 21, lineHeight: 27, fontWeight: "700" },
  cardBody: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  button: { minHeight: 50, borderRadius: 10, backgroundColor: colors.gold, paddingHorizontal: 18, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  buttonSecondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.78 },
  buttonText: { color: colors.navy, fontSize: 15, fontWeight: "800" },
  buttonTextSecondary: { color: colors.text },
  stack: { gap: 10 },
  helper: { color: colors.soft, fontSize: 12, lineHeight: 18 },
  reviewGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  valueCard: { width: "48%", minHeight: 80, backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 13, gap: 6 },
  valueLabel: { color: colors.soft, fontSize: 12, fontWeight: "700" },
  value: { color: colors.text, fontSize: 17, fontWeight: "700" },
  warning: { color: colors.gold, fontSize: 14, lineHeight: 20 },
  actions: { gap: 10 },
  surveyCard: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 18, gap: 16 },
  optionRow: { flexDirection: "row", gap: 8 },
  rating: { width: 44, height: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  ratingSelected: { backgroundColor: colors.gold, borderColor: colors.gold },
  ratingText: { color: colors.text, fontWeight: "800" },
  ratingTextSelected: { color: colors.navy },
  optionWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  optionSelected: { backgroundColor: colors.gold, borderColor: colors.gold },
  optionText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  optionTextSelected: { color: colors.navy },
  input: { minHeight: 100, borderWidth: 1, borderColor: colors.border, borderRadius: 10, color: colors.text, padding: 12, textAlignVertical: "top", fontSize: 15 },
  emptyCard: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 18, gap: 12 },
  auditCard: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 18, gap: 8 },
  auditHeader: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  auditDate: { color: colors.soft, fontSize: 12, paddingTop: 5 },
  auditExpiry: { color: colors.gold, fontSize: 13, fontWeight: "700" },
  accountCard: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 18, gap: 14 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  message: { color: colors.gold, fontSize: 14, lineHeight: 20 },
  loader: { marginVertical: 8 },
});

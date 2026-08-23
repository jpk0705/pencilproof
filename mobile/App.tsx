import { ClerkProvider, useAuth, useSSO, useUser } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";
import { makeRedirectUri } from "expo-auth-session";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  Linking,
  Modal,
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
const CLERK_REDIRECT_URL = makeRedirectUri({ scheme: "pencilproof", path: "/sso-callback" });
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

type Screen = "home" | "auth" | "review" | "survey" | "audits" | "auditDetail" | "account" | "salesDashboard";
type AuthStrategy = "oauth_google" | "oauth_apple" | "oauth_facebook";
type AccountRole = "consumer" | "salesperson";
type CompareSlot = "first" | "second" | null;
type ReviewAccess = "checking" | "paid" | "guest";

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

const displayText = (value: unknown, fallback = ""): string => {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => displayText(item)).filter(Boolean);
    return items.join(" · ") || fallback;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const parts = [record.label, record.detail, record.name, record.value]
      .map((item) => displayText(item))
      .filter(Boolean);
    return parts.join(" — ") || fallback;
  }
  return fallback;
};

const BRAND_MARK = require("./assets/pencilproof-profile-mark.png");

const formatMoney = (value: unknown) => {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) && amount > 0
    ? `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "Not entered";
};

const isActive = (expiresAt: number | null) => Boolean(expiresAt && expiresAt > Math.floor(Date.now() / 1000));

const errorMessage = (error: unknown) => {
  if (error instanceof ApiError) {
    if (error.code === "AI_IMPORT_NOT_CONFIGURED") return "Quote scanning is temporarily unavailable. Please try again shortly.";
    if (error.code === "AI_IMPORT_TOO_LARGE") return "That file is too large. Choose a smaller photo or PDF.";
    if (error.code === "account_required" || error.code === "ACCOUNT_REQUIRED") return "Your sign-in session is not connected to this scan. Refresh the app and sign in again, then retry.";
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
  children: ReactNode;
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

const PROVIDER_MARKS = {
  google: require("./assets/provider-google.png"),
  apple: require("./assets/provider-apple.png"),
  facebook: require("./assets/provider-facebook.png"),
} as const;

const ProviderIcon = ({ provider }: { provider: "google" | "apple" | "facebook" }) => (
  <Image
    accessibilityLabel={`${provider} logo`}
    accessibilityIgnoresInvertColors
    source={PROVIDER_MARKS[provider]}
    style={styles.providerLogo}
  />
);

const ProviderButton = ({
  label,
  provider,
  onPress,
  secondary = false,
  disabled = false,
}: {
  label: string;
  provider: "google" | "apple" | "facebook";
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [
      styles.button,
      secondary && styles.buttonSecondary,
      disabled && styles.buttonDisabled,
      pressed && !disabled && styles.buttonPressed,
    ]}
  >
    <View style={styles.providerButtonContent}>
      <View style={styles.providerIcon}><ProviderIcon provider={provider} /></View>
      <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{label}</Text>
    </View>
  </Pressable>
);

const SectionTitle = ({ eyebrow, title, body }: { eyebrow?: string; title: string; body?: string }) => (
  <View style={styles.titleBlock}>
    {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
    <Text style={styles.title}>{title}</Text>
    {body ? <Text style={styles.body}>{body}</Text> : null}
  </View>
);

const BrandMark = ({ animated = false, scale = 1 }: { animated?: boolean; scale?: number }) => (
  <View style={[styles.brandMark, animated && styles.brandMarkAnimated, { transform: [{ scale }] }]}>
    <Image
      accessibilityIgnoresInvertColors
      source={BRAND_MARK}
      style={[styles.brandMarkImage, animated && styles.brandMarkImageAnimated]}
    />
</View>
);

const LoginButtons = ({ onLogin, busy }: { onLogin: (strategy: AuthStrategy) => void; busy: boolean }) => (
  <View style={styles.stack}>
    <ProviderButton disabled={busy} label="Continue with Google" onPress={() => onLogin("oauth_google")} provider="google" />
    <ProviderButton disabled={busy} label="Continue with Apple" onPress={() => onLogin("oauth_apple")} provider="apple" secondary />
    <ProviderButton disabled={busy} label="Continue with Facebook" onPress={() => onLogin("oauth_facebook")} provider="facebook" secondary />
    <Text style={styles.helper}>Your account choice controls whether you return to My Audits or the salesperson experience.</Text>
  </View>
);

const ProgressRail = ({ step }: { step: 1 | 2 | 3 }) => (
  <View style={styles.progressRail} accessibilityLabel={`Step ${step} of 3`}>
    {["Scan", "Verify", "Decide"].map((label, index) => {
      const current = index + 1;
      return <View key={label} style={styles.progressStep}><View style={[styles.progressDot, current <= step && styles.progressDotActive]} /><Text style={[styles.progressLabel, current <= step && styles.progressLabelActive]}>{label}</Text></View>;
    })}
  </View>
);

function PencilProofApp() {
  const { getToken, isSignedIn, signOut } = useAuth();
  const { startSSOFlow } = useSSO();
  const { user } = useUser();
  const splashScale = useRef(new Animated.Value(0.82)).current;
  const splashOpacity = useRef(new Animated.Value(1)).current;
  const roleSyncInFlight = useRef(false);
  const [booting, setBooting] = useState(true);
  const [screen, setScreen] = useState<Screen>("home");
  const [quote, setQuote] = useState<ImportResult | null>(null);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loginError, setLoginError] = useState("");
  const [audits, setAudits] = useState<Audit[]>([]);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [reviewExpiresAt, setReviewExpiresAt] = useState<number | null>(null);
  const [reviewAccess, setReviewAccess] = useState<ReviewAccess>("guest");
  const [accountRole, setAccountRole] = useState<AccountRole>("consumer");
  const [authContext, setAuthContext] = useState<AccountRole>("consumer");
  const [surveyRating, setSurveyRating] = useState(5);
  const [surveyWorth, setSurveyWorth] = useState("30-39.99");
  const [surveyComment, setSurveyComment] = useState("");
  const [deleteReason, setDeleteReason] = useState("");
  const [auditSaveMessage, setAuditSaveMessage] = useState("");
  const [selectedAudit, setSelectedAudit] = useState<Audit | null>(null);
  const [compareSlot, setCompareSlot] = useState<CompareSlot>(null);
  const [compareFirstId, setCompareFirstId] = useState<string | null>(null);
  const [compareSecondId, setCompareSecondId] = useState<string | null>(null);

  const email = user?.primaryEmailAddress?.emailAddress ?? "";

  const syncAccount = useCallback(async (requestedRole?: AccountRole) => {
    const token = await getToken();
    if (!token || !user) return null;
    const role = requestedRole ?? "auto";
    const session = await apiRequest<{ ok: boolean; role?: "consumer" | "salesperson" }>("/api/account/session", {
      method: "POST",
      body: JSON.stringify({ email, token, role }),
    }, token);
    const resolvedRole = session.role === "salesperson" ? "salesperson" : "consumer";
    setAccountRole(resolvedRole);
    setAuthContext(resolvedRole);
    return token;
  }, [email, getToken, user]);

  const loadAccount = useCallback(async (requestedRole?: AccountRole) => {
    if (!isSignedIn) {
      setAudits([]);
      setExpiresAt(null);
      setAccountRole("consumer");
      return null;
    }
    const token = await syncAccount(requestedRole);
    if (!token) return null;
    const result = await apiRequest<AccountMe>("/api/account/me", {}, token);
    setAudits(result.audits ?? []);
    setExpiresAt(result.expiresAt ?? null);
    setAccountRole(result.role === "salesperson" ? "salesperson" : "consumer");
    setCompareFirstId((current) => current && result.audits.some((audit) => audit.id === current) ? current : result.audits[0]?.id ?? null);
    setCompareSecondId((current) => current && result.audits.some((audit) => audit.id === current) ? current : result.audits[1]?.id ?? result.audits[0]?.id ?? null);
    return { token, result };
  }, [isSignedIn, syncAccount]);

  const loadAudits = useCallback(async () => {
    setBusy(true);
    setMessage("");
    try {
      await loadAccount();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [loadAccount]);

  useEffect(() => {
    if (!isSignedIn || !user || roleSyncInFlight.current) return;
    // Initial account hydration is background work. Do not surface a
    // transient account/API failure over a quote scan that is still usable;
    // explicit My Audits or Account actions report their own errors.
    void loadAccount().catch(() => undefined);
  }, [isSignedIn, loadAccount, user]);

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(splashScale, { toValue: 20, duration: 1500, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      Animated.timing(splashOpacity, { toValue: 0, delay: 950, duration: 550, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]);
    animation.start();
    const timer = setTimeout(() => setBooting(false), 1580);
    return () => clearTimeout(timer);
  }, [splashOpacity, splashScale]);

  const handleLogin = async (strategy: AuthStrategy) => {
    const requestedRole = authContext;
    roleSyncInFlight.current = true;
    setBusy(true);
    setLoginError("");
    try {
      const result = await startSSOFlow({ strategy, redirectUrl: CLERK_REDIRECT_URL });
      if (result.createdSessionId) {
        await result.setActive?.({ session: result.createdSessionId });
        await syncAccount(requestedRole);
        const account = await loadAccount(requestedRole);
        if (requestedRole === "salesperson" && account?.result.role !== "salesperson") {
          setLoginError("This identity is already connected as a consumer. Use a different sign-in account for the salesperson experience.");
          setScreen("auth");
        } else {
          setScreen("home");
        }
      } else {
        setLoginError(strategy === "oauth_facebook"
          ? "Facebook sign-in is unavailable while the Facebook provider is inactive. Google and Apple sign-in are available."
          : "The sign-in flow did not finish. Please try again.");
      }
    } catch (error) {
      const detail = errorMessage(error);
      const provider = strategy === "oauth_google" ? "Google" : strategy === "oauth_apple" ? "Apple" : "Facebook";
      setLoginError(strategy === "oauth_facebook"
        ? "Facebook sign-in is unavailable while the Facebook provider is inactive. Google and Apple sign-in are available."
        : `${provider} sign-in could not be completed. ${detail}`);
    } finally {
      roleSyncInFlight.current = false;
      setBusy(false);
    }
  };

  const uploadQuote = async (uri: string, mimeType: string) => {
    setBusy(true);
    setMessage("");
    setReviewExpiresAt(null);
    setSelectedOfferId(null);
    setReviewAccess(isSignedIn ? "checking" : "guest");
    try {
      const result = await importQuote(uri, mimeType, await getToken());
      // Account hydration can finish in parallel with a camera import. Do not
      // let an unrelated background status overwrite the successful review.
      setMessage("");
      if (isSignedIn) {
        try {
          const account = await loadAccount();
          const nextExpiresAt = account?.result.expiresAt ?? null;
          setReviewExpiresAt(nextExpiresAt);
          setReviewAccess(isActive(nextExpiresAt) ? "paid" : "guest");
        } catch {
          // Keep checkout blocked until the signed-in account can be checked.
          setReviewAccess("checking");
          setMessage("PencilProof could not verify your account access yet. Retry the access check before continuing.");
        }
      }
      setQuote(result);
      setScreen("review");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const updateQuoteField = (key: string, rawValue: string) => {
    if (["cashDown", "term", "quotedPayment", "apr", "rebate"].includes(key)) setSelectedOfferId(null);
    setQuote((current) => {
      if (!current) return current;
      const isText = key === "vehicle" || key === "vin";
      const value = isText ? rawValue : rawValue.trim() === "" ? "" : Number(rawValue.replace(/[$,]/g, ""));
      return { ...current, fields: { ...current.fields, [key]: value } };
    });
  };

  const chooseImportedOffer = (option: NonNullable<ImportResult["offerMatrix"]>["options"][number]) => {
    setSelectedOfferId(option.id);
    setQuote((current) => {
      if (!current) return current;
      return {
        ...current,
        fields: {
          ...current.fields,
          cashDown: option.cashDown,
          term: option.term,
          quotedPayment: option.payment,
          ...(option.apr !== undefined ? { apr: option.apr } : {}),
          ...(option.rebate !== undefined ? { rebate: option.rebate } : {}),
        },
      };
    });
  };

  const saveCurrentAudit = async () => {
    if (!quote) return false;
    if (!isSignedIn || !isActive(reviewExpiresAt ?? expiresAt)) {
      setAuditSaveMessage("Sign in with active access to save this audit.");
      return false;
    }
    setBusy(true);
    setAuditSaveMessage("");
    try {
      const token = await getToken();
      const fields = quote.fields;
      const data = {
        ...fields,
        vehicle: typeof fields.vehicle === "string" ? fields.vehicle : undefined,
        vin: typeof fields.vin === "string" ? fields.vin : undefined,
        price: fields.price ?? fields.sellingPrice,
        payment: fields.payment ?? fields.calculatedPayment ?? fields.quotedPayment,
        quotedPayment: fields.quotedPayment ?? fields.payment,
        apr: fields.apr ?? fields.dealerApr,
        loanTerm: fields.loanTerm ?? fields.term,
        amountFinanced: fields.amountFinanced,
        verdict: "Imported quote reviewed on mobile",
      };
      const saved = await apiRequest<{ id: string }>("/api/audits", {
        method: "POST",
        body: JSON.stringify({ data }),
      }, token);
      setAuditSaveMessage(saved.id ? "Saved to My Audits." : "Audit saved.");
      await loadAccount();
      return Boolean(saved.id);
    } catch (error) {
      setAuditSaveMessage(errorMessage(error));
      return false;
    } finally {
      roleSyncInFlight.current = false;
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
      mediaTypes: "images",
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

  const openSavedAudit = (auditId: string) => {
    const audit = audits.find((item) => item.id === auditId);
    if (!audit) {
      setMessage("That saved audit is no longer available. Refresh My Audits and try again.");
      return;
    }
    setSelectedAudit(audit);
    setScreen("auditDetail");
  };

  const compareFirst = audits.find((audit) => audit.id === compareFirstId) ?? null;
  const compareSecond = audits.find((audit) => audit.id === compareSecondId) ?? null;
  const compareRows = [
    ["Vehicle", compareFirst?.data.vehicle, compareSecond?.data.vehicle],
    ["VIN", compareFirst?.data.vin, compareSecond?.data.vin],
    ["Price", formatMoney(compareFirst?.data.price ?? compareFirst?.data.sellingPrice), formatMoney(compareSecond?.data.price ?? compareSecond?.data.sellingPrice)],
    ["Payment", formatMoney(compareFirst?.data.payment ?? compareFirst?.data.calculatedPayment ?? compareFirst?.data.quotedPayment), formatMoney(compareSecond?.data.payment ?? compareSecond?.data.calculatedPayment ?? compareSecond?.data.quotedPayment)],
    ["APR", compareFirst?.data.apr ? `${compareFirst.data.apr}%` : "Not entered", compareSecond?.data.apr ? `${compareSecond.data.apr}%` : "Not entered"],
    ["Amount financed", formatMoney(compareFirst?.data.amountFinanced), formatMoney(compareSecond?.data.amountFinanced)],
  ];

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
            setAuthContext("consumer");
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
      <Pressable accessibilityLabel="PencilProof home" onPress={() => setScreen("home")} style={styles.brandLockup}><BrandMark /><Text style={styles.brand}>PencilProof</Text></Pressable>
      <View style={styles.navLinks}>
        {isSignedIn && accountRole === "consumer" ? <Pressable onPress={() => { setScreen("audits"); void loadAudits(); }}><Text style={styles.navLink}>My Audits</Text></Pressable> : null}
        {isSignedIn && accountRole === "salesperson" ? <Pressable onPress={() => setScreen("salesDashboard")}><Text style={styles.navLink}>Sales Dashboard</Text></Pressable> : null}
        <Pressable accessibilityLabel={isSignedIn ? "Account" : "Sign in"} onPress={() => { if (!isSignedIn) setAuthContext("consumer"); setScreen(isSignedIn ? "account" : "auth"); }}><Text style={styles.navLink}>{isSignedIn ? "Account" : "Sign in"}</Text></Pressable>
      </View>
    </View>
  ), [accountRole, email, isSignedIn, loadAudits]);

  const renderAuth = () => (
    <>
      <SectionTitle
        eyebrow={authContext === "salesperson" ? "SALESPERSON SIGN IN" : "SIGN IN"}
        title={authContext === "salesperson" ? "Open your salesperson dashboard." : "Keep your PencilProof access connected."}
        body={authContext === "salesperson" ? "Sign in through this path to keep your salesperson tools and dashboard separate from My Audits." : "Sign in to keep paid audits connected across devices and return to the exact numbers you reviewed."}
      />
      <View style={styles.signInCard}>
        <Text style={styles.cardTitle}>Choose how you want to sign in</Text>
        <LoginButtons busy={busy} onLogin={(strategy) => void handleLogin(strategy)} />
        <Button secondary onPress={() => { setScreen("home"); setLoginError(""); }}>Back to home</Button>
      </View>
    </>
  );

  const renderHome = () => (
    <>
      <ProgressRail step={1} />
      <SectionTitle
        eyebrow="YOUR QUOTE, MADE CLEAR"
        title="Know what you are getting before checkout."
        body="Start with one photo or file. PencilProof detects the deal, lets you correct the numbers, and shows what to verify next."
      />
      <View style={styles.startCard}>
        <View style={styles.startIcon}><BrandMark scale={0.82} /></View>
        <Text style={styles.cardTitle}>Review your quote free</Text>
        <Text style={styles.cardBody}>Scan a physical quote or choose a saved PDF/image. You will see the detected values before any payment.</Text>
        <Button disabled={busy} onPress={() => void takePhoto()}>Take photo</Button>
        <Button disabled={busy} onPress={() => void chooseFile()} secondary>Choose PDF or image</Button>
      </View>
      <View style={styles.trustRow}>
        <View style={styles.trustItem}><Text style={styles.trustNumber}>01</Text><Text style={styles.trustText}>Detect</Text></View>
        <View style={styles.trustItem}><Text style={styles.trustNumber}>02</Text><Text style={styles.trustText}>Correct</Text></View>
        <View style={styles.trustItem}><Text style={styles.trustNumber}>03</Text><Text style={styles.trustText}>Decide</Text></View>
      </View>
      {!isSignedIn ? (
        <View style={styles.signInCard}>
          <Text style={styles.cardTitle}>Keep your audit history connected</Text>
          <Text style={styles.cardBody}>Sign in to keep paid audits connected across devices and return to the exact numbers you reviewed.</Text>
          <LoginButtons busy={busy} onLogin={(strategy) => void handleLogin(strategy)} />
          <Button secondary onPress={() => { setAuthContext("salesperson"); setLoginError(""); setScreen("auth"); }}>For salespeople</Button>
        </View>
      ) : (
        <View style={styles.accountStrip}>
          <Text style={styles.eyebrow}>SIGNED IN</Text>
          <Text style={styles.cardBody}>{email || "Your PencilProof account"}{accountRole === "salesperson" ? " · Salesperson" : " · Consumer"}</Text>
          {accountRole === "salesperson" ? (
            <Button secondary onPress={() => setScreen("salesDashboard")}>Open Salesperson Dashboard</Button>
          ) : (
            <Button secondary onPress={() => { setScreen("audits"); void loadAudits(); }}>Open My Audits</Button>
          )}
        </View>
      )}
    </>
  );

  const renderSalesDashboard = () => (
    <>
      <SectionTitle
        eyebrow="SALESPERSON DASHBOARD"
        title="Keep the next quote conversation clear."
        body={`Signed in as ${email || "your verified account"}. Your salesperson tools stay inside the app.`}
      />
      <View style={styles.dashboardCard}>
        <Text style={styles.eyebrow}>YOUR TOOLS</Text>
        <Text style={styles.cardTitle}>Move from quote to answer without leaving PencilProof.</Text>
        <Text style={styles.cardBody}>Review saved audits, start another quote, and keep your account access in one place.</Text>
        <Button onPress={() => { setScreen("audits"); void loadAudits(); }}>Open saved audits</Button>
        <Button secondary onPress={() => setScreen("home")}>Review another quote</Button>
      </View>
      <View style={styles.dashboardCard}>
        <Text style={styles.eyebrow}>SALESPERSON ACCESS</Text>
        <Text style={styles.cardTitle}>{isActive(expiresAt) ? "Subscription active" : "Subscription status"}</Text>
        <Text style={styles.cardBody}>{isActive(expiresAt) ? `Available through ${formatDate(expiresAt)}.` : "Your dashboard is connected. Check your account for subscription details."}</Text>
        <Button secondary onPress={() => setScreen("account")}>Open account</Button>
      </View>
    </>
  );

  const renderReview = () => (
    <>
      <ProgressRail step={2} />
      <SectionTitle eyebrow="REVIEW BEFORE CHECKOUT" title="Confirm the quote values."
        body="PencilProof made a first pass. Correct anything that does not match the original quote before continuing." />
      {quote?.offerMatrix ? (
        <View style={styles.offerMatrix} accessibilityLabel="Payment options detected">
          <Text style={styles.offerEyebrow}>MULTIPLE OPTIONS DETECTED</Text>
          <Text style={styles.cardTitle}>Choose the payment option you want to review.</Text>
          <Text style={styles.cardBody}>Select the exact cash-down, term, and payment row from the worksheet. PencilProof will use that row for the audit.</Text>
          <View style={styles.offerList}>
            {quote.offerMatrix.options.map((option) => (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityLabel={`${option.type === "finance" ? "Finance" : "Lease"}, ${option.term} months, ${formatMoney(option.cashDown)} down, ${formatMoney(option.payment)} per month`}
                onPress={() => chooseImportedOffer(option)}
                style={[styles.offerCard, selectedOfferId === option.id && styles.offerCardSelected]}
              >
                <Text style={styles.offerCardType}>{option.type === "finance" ? "FINANCE" : "LEASE"}</Text>
                <Text style={styles.offerCardPayment}>{formatMoney(option.payment)}<Text style={styles.offerCardSuffix}> / month</Text></Text>
                <Text style={styles.offerCardMeta}>{option.cashDown.toLocaleString()} down · {option.term} months{option.apr !== undefined ? ` · ${option.apr.toFixed(2)}% APR` : ""}</Text>
                <Text style={[styles.offerCardAction, selectedOfferId === option.id && styles.offerCardActionSelected]}>{selectedOfferId === option.id ? "Selected" : "Choose this option"}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      <View style={styles.reviewGrid}>
        {Object.entries(quote?.fields ?? {}).map(([key, value]) => (
          <View key={key} style={styles.valueCard}>
            <Text style={styles.valueLabel}>{fieldLabel(key)}</Text>
            <TextInput
              accessibilityLabel={fieldLabel(key)}
              keyboardType={key === "vehicle" || key === "vin" ? "default" : "decimal-pad"}
              onChangeText={(nextValue) => updateQuoteField(key, nextValue)}
              style={styles.valueInput}
              value={String(value ?? "")}
            />
          </View>
        ))}
      </View>
      {quote?.productItems?.length ? (
        <View style={styles.productReviewCard} accessibilityLabel="Imported product details">
          <Text style={styles.productReviewEyebrow}>PRODUCT DETAILS FROM THE QUOTE</Text>
          <Text style={styles.productReviewBody}>These itemized amounts are tied to the category totals above. Compare each one with the original document.</Text>
          {quote.productItems.map((item) => (
            <View key={`${item.category}-${item.name}-${item.amount}`} style={styles.productReviewRow}>
              <Text style={styles.productReviewName}>{item.name}</Text>
              <Text style={styles.productReviewAmount}>{formatMoney(item.amount)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {quote?.warnings?.filter((warning) => !warning.startsWith("Product details from the quote:")).map((warning) => <Text key={warning} style={styles.warning}>Review: {warning}</Text>)}
      {!Object.keys(quote?.fields ?? {}).length ? <Text style={styles.warning}>No confident values were detected. You can still continue, but review the original quote carefully.</Text> : null}
      <View style={styles.actions}>
        <Button disabled={busy || Boolean(quote?.offerMatrix && !selectedOfferId) || (isSignedIn && reviewAccess === "checking" && !isActive(reviewExpiresAt ?? expiresAt))} onPress={() => {
          if (isActive(reviewExpiresAt ?? expiresAt)) {
            void (async () => {
              if (await saveCurrentAudit()) setScreen("audits");
            })();
          } else {
            setScreen("survey");
          }
        }}>{quote?.offerMatrix && !selectedOfferId
          ? "Choose a payment option to continue"
          : isSignedIn && reviewAccess === "checking" && !isActive(reviewExpiresAt ?? expiresAt)
          ? "Checking your PencilProof access…"
          : isActive(reviewExpiresAt ?? expiresAt) ? "Confirm values and save audit" : "Confirm values and continue"}</Button>
        {isSignedIn && reviewAccess === "checking" && !isActive(reviewExpiresAt ?? expiresAt) ? <Button disabled={busy} secondary onPress={() => void (async () => {
          setBusy(true);
          setMessage("");
          try {
            const account = await loadAccount();
            const nextExpiresAt = account?.result.expiresAt ?? null;
            setReviewExpiresAt(nextExpiresAt);
            setReviewAccess(isActive(nextExpiresAt) ? "paid" : "guest");
            if (!isActive(nextExpiresAt)) setMessage("This account does not have active paid access, so checkout is available after the free review.");
          } catch {
            setReviewAccess("checking");
            setMessage("PencilProof could not verify your account access yet. Please retry.");
          } finally {
            setBusy(false);
          }
        })()}>Retry access check</Button> : null}
        {isActive(reviewExpiresAt ?? expiresAt) ? <Button disabled={busy} secondary onPress={() => void saveCurrentAudit()}>Save audit</Button> : null}
        <Button secondary onPress={() => setScreen("home")}>Choose another quote</Button>
      </View>
      {auditSaveMessage ? <Text style={styles.message}>{auditSaveMessage}</Text> : null}
    </>
  );

  const worthOptions = ["0-9.99", "10-19.99", "20-29.99", "30-39.99", "40+"];
  const renderSurvey = () => (
    <>
      <ProgressRail step={3} />
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
      <SectionTitle eyebrow={accountRole === "salesperson" ? "SALESPERSON SAVED AUDITS" : "MY AUDITS"} title="Your saved audit history."
        body={!isSignedIn ? "Sign in to see audits connected to this account." : expiresAt ? `Your account access is available through ${formatDate(expiresAt)}.` : "Your saved paid audits will appear here after you complete one while signed in."} />
      {busy ? <ActivityIndicator color={colors.gold} /> : null}
      {accountRole === "salesperson" ? <View style={styles.roleBanner}><Text style={styles.eyebrow}>SALESPERSON ACCOUNT</Text><Text style={styles.cardBody}>These are your saved salesperson audits. Use the dashboard to start another review.</Text><Button secondary onPress={() => setScreen("salesDashboard")}>Back to Sales Dashboard</Button></View> : null}
      {!busy && audits.length === 0 ? <View style={styles.emptyCard}><Text style={styles.cardTitle}>No saved audits yet.</Text><Text style={styles.cardBody}>Complete a paid audit while signed in and it will appear here.</Text><Button onPress={() => setScreen("home")}>Review a quote</Button></View> : null}
      {audits.map((audit) => (
        <Pressable accessibilityRole="button" key={audit.id} onPress={() => openSavedAudit(audit.id)} style={styles.auditCard}>
          <View style={styles.auditHeader}><Text style={[styles.cardTitle, styles.auditTitle]}>{displayText(audit.data?.vehicle, "Vehicle audit")}</Text><Text style={styles.auditDate}>{formatDate(audit.createdAt)}</Text></View>
          <Text style={styles.auditLabel}>{audit.data?.vin ? `VIN ${audit.data.vin}` : "VIN not detected"}</Text>
          <View style={styles.auditMetrics}>
            <View><Text style={styles.metricLabel}>PRICE</Text><Text style={styles.metricValue}>{formatMoney(audit.data?.price ?? audit.data?.sellingPrice)}</Text></View>
            <View><Text style={styles.metricLabel}>PAYMENT</Text><Text style={styles.metricValue}>{formatMoney(audit.data?.payment ?? audit.data?.calculatedPayment ?? audit.data?.quotedPayment)}</Text></View>
            <View><Text style={styles.metricLabel}>APR</Text><Text style={styles.metricValue}>{audit.data?.apr ? `${audit.data.apr}%` : "—"}</Text></View>
            <View><Text style={styles.metricLabel}>FINANCED</Text><Text style={styles.metricValue}>{formatMoney(audit.data?.amountFinanced)}</Text></View>
          </View>
          <Text style={styles.cardBody}>{displayText(audit.data?.verdict, "Tap to open this saved audit")}</Text>
          <Text style={styles.auditExpiry}>Available through {formatDate(audit.expiresAt)}</Text>
        </Pressable>
      ))}
      {audits.length > 1 ? <View style={styles.compareCard}>
        <Text style={styles.eyebrow}>COMPARE</Text>
        <Text style={styles.cardTitle}>See two saved audits side by side.</Text>
        <Text style={styles.cardBody}>Compare an original quote with a revision or compare two vehicles.</Text>
        <Button secondary onPress={() => setCompareSlot("first")}>First audit: {displayText(compareFirst?.data.vehicle, "Choose an audit")}</Button>
        <Button secondary onPress={() => setCompareSlot("second")}>Second audit: {displayText(compareSecond?.data.vehicle, "Choose an audit")}</Button>
        {compareFirst && compareSecond ? <View style={styles.compareTable}>
          {compareRows.map(([label, first, second]) => <View key={label} style={styles.compareRow}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.compareValue}>{String(first ?? "Not entered")}</Text><Text style={styles.compareValue}>{String(second ?? "Not entered")}</Text></View>)}
        </View> : null}
      </View> : null}
      <Modal animationType="slide" transparent visible={compareSlot !== null} onRequestClose={() => setCompareSlot(null)}>
        <View style={styles.modalBackdrop}><View style={styles.modalCard}><Text style={styles.cardTitle}>Choose a saved audit</Text>{audits.map((audit) => <Pressable key={audit.id} onPress={() => { if (compareSlot === "first") setCompareFirstId(audit.id); if (compareSlot === "second") setCompareSecondId(audit.id); setCompareSlot(null); }} style={styles.modalOption}><Text style={styles.modalOptionTitle}>{displayText(audit.data?.vehicle, "Vehicle audit")}</Text><Text style={styles.modalOptionBody}>{formatDate(audit.createdAt)} · {displayText(audit.data?.vin, "VIN not detected")}</Text></Pressable>)}<Button secondary onPress={() => setCompareSlot(null)}>Cancel</Button></View></View>
      </Modal>
    </>
  );

  const renderAuditDetail = () => {
    if (!selectedAudit) return renderAudits();
    const data = selectedAudit.data;
    const detailRows = [
      ["Price", formatMoney(data.price ?? data.sellingPrice)],
      ["Payment", formatMoney(data.payment ?? data.calculatedPayment ?? data.quotedPayment)],
      ["APR", data.apr ? `${data.apr}%` : "Not entered"],
      ["Term", data.loanTerm ?? data.term ? `${data.loanTerm ?? data.term} months` : "Not entered"],
      ["Amount financed", formatMoney(data.amountFinanced)],
      ["Cash down", formatMoney(data.cashDown)],
    ];
    return (
      <>
        <Button secondary onPress={() => { setSelectedAudit(null); setScreen(accountRole === "salesperson" ? "salesDashboard" : "audits"); }}>{accountRole === "salesperson" ? "Back to Sales Dashboard" : "Back to My Audits"}</Button>
        <SectionTitle
          eyebrow="SAVED AUDIT"
          title={displayText(data.vehicle, "Saved quote audit")}
          body={`Saved ${formatDate(selectedAudit.createdAt)}. Review the numbers and notes inside PencilProof.`}
        />
        <View style={styles.auditDetailCard}>
          <Text style={styles.eyebrow}>VEHICLE REFERENCE</Text>
          <Text style={styles.cardTitle}>{displayText(data.vehicle, "Vehicle not identified")}</Text>
          <Text style={styles.auditLabel}>{data.vin ? `VIN ${displayText(data.vin)}` : "VIN not detected"}</Text>
        </View>
        <View style={styles.auditDetailCard}>
          <Text style={styles.eyebrow}>SAVED NUMBERS</Text>
          <View style={styles.detailGrid}>
            {detailRows.map(([label, value]) => (
              <View key={label} style={styles.detailCell}>
                <Text style={styles.metricLabel}>{label}</Text>
                <Text style={styles.detailValue}>{value}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.auditDetailCard}>
          <Text style={styles.eyebrow}>REVIEW NOTES</Text>
          <Text style={styles.cardBody}>{displayText(data.verdict, "No saved review note was provided.")}</Text>
          {data.flags?.map((flag, index) => (
            <View key={`${flag.name ?? "flag"}-${index}`} style={styles.flagRow}>
              <Text style={styles.flagName}>{displayText(flag.name, "Review item")}</Text>
              <Text style={styles.cardBody}>{displayText(flag.detail, "Check this item against the quote.")}</Text>
            </View>
          ))}
          <Text style={styles.auditExpiry}>Available through {formatDate(selectedAudit.expiresAt)}</Text>
        </View>
        <Button onPress={() => setScreen("home")}>Review another quote</Button>
      </>
    );
  };

  const renderAccount = () => {
    const reasons = ["Price too high", "I no longer need the service", "Something did not work", "I could not get the result I needed", "Other"];
    return (
      <>
        <SectionTitle eyebrow="ACCOUNT" title="Your PencilProof account."
          body={`Signed in as ${email || "your verified account"}.`} />
        <View style={styles.accountCard}>
          <Text style={styles.cardTitle}>Account access</Text>
          <Text style={styles.cardBody}>Signed in as {email || "your verified account"}. {accountRole === "salesperson" ? "Use the Sales Dashboard to manage salesperson tools and saved audits." : "Use My Audits to view saved purchase history."}</Text>
          {accountRole === "salesperson" ? <Button secondary onPress={() => setScreen("salesDashboard")}>Open Salesperson Dashboard</Button> : null}
          <Button secondary onPress={() => { setAuthContext("consumer"); void signOut(); }}>Sign out</Button>
        </View>
        <View style={styles.accountCard}>
          <Text style={styles.cardTitle}>Questions and support</Text>
          <Text style={styles.cardBody}>Find answers or contact PencilProof if you need help with an audit.</Text>
          <Button secondary onPress={() => void Linking.openURL("https://pencilproof.com/questions")}>Open Q&amp;A</Button>
          <Button secondary onPress={() => void Linking.openURL("mailto:support@pencilproof.com")}>Contact support</Button>
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
  if (screen === "auth") content = renderAuth();
  if (screen === "review") content = renderReview();
  if (screen === "survey") content = renderSurvey();
  if (screen === "audits") content = renderAudits();
  if (screen === "auditDetail") content = renderAuditDetail();
  if (screen === "account") content = isSignedIn ? renderAccount() : renderHome();
  if (screen === "salesDashboard") content = isSignedIn && accountRole === "salesperson" ? renderSalesDashboard() : renderHome();

  if (booting) {
    return (
      <SafeAreaView style={styles.splash}>
        <Text style={styles.splashWordmark}>PencilProof</Text>
        <Text style={styles.splashTagline}>Make the numbers clear.</Text>
        <Animated.View style={{ opacity: splashOpacity, transform: [{ scale: splashScale }] }}>
          <BrandMark animated scale={1.45} />
        </Animated.View>
      </SafeAreaView>
    );
  }

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
  splash: { flex: 1, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center", gap: 12 },
  splashWordmark: { color: colors.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.8 },
  splashTagline: { color: colors.soft, fontSize: 14 },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.navy },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandMark: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.panelStrong, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  brandMarkAnimated: { width: 108, height: 108, borderRadius: 28, backgroundColor: colors.gold, overflow: "hidden" },
  brandMarkImage: { width: 34, height: 34, borderRadius: 10 },
  brandMarkImageAnimated: { width: 76, height: 76, borderRadius: 20 },
  brand: { color: colors.text, fontSize: 18, fontWeight: "800", letterSpacing: -0.4 },
  navLinks: { flexDirection: "row", alignItems: "center", gap: 12 },
  navLink: { color: colors.gold, fontSize: 13, fontWeight: "700" },
  content: { padding: 18, paddingBottom: 56, gap: 16 },
  progressRail: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 12, marginBottom: 2 },
  progressStep: { flexDirection: "row", alignItems: "center", gap: 6 },
  progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  progressDotActive: { backgroundColor: colors.gold },
  progressLabel: { color: colors.soft, fontSize: 12, fontWeight: "700" },
  progressLabelActive: { color: colors.text },
  titleBlock: { gap: 10, marginBottom: 4, minWidth: 0 },
  eyebrow: { color: colors.gold, fontSize: 12, fontWeight: "800", letterSpacing: 1.5 },
  title: { color: colors.text, fontSize: 32, lineHeight: 38, fontWeight: "800", letterSpacing: -0.7, flexShrink: 1 },
  body: { color: colors.muted, fontSize: 16, lineHeight: 24, flexShrink: 1 },
  startCard: { backgroundColor: colors.panelStrong, borderColor: colors.gold, borderWidth: 1, borderRadius: 18, padding: 20, gap: 13 },
  startIcon: { alignSelf: "flex-start", width: 44, height: 44, borderRadius: 14, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  trustRow: { flexDirection: "row", justifyContent: "space-between", backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 14 },
  trustItem: { flexDirection: "row", alignItems: "center", gap: 7 },
  trustNumber: { color: colors.gold, fontSize: 12, fontWeight: "900" },
  trustText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  featureCard: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 18, gap: 12 },
  signInCard: { backgroundColor: colors.panelStrong, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 18, gap: 12 },
  accountStrip: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 18, gap: 12 },
  dashboardCard: { backgroundColor: colors.panelStrong, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 18, gap: 13 },
  cardTitle: { color: colors.text, fontSize: 21, lineHeight: 27, fontWeight: "700", flexShrink: 1 },
  cardBody: { color: colors.muted, fontSize: 15, lineHeight: 22, flexShrink: 1 },
  button: { minHeight: 50, borderRadius: 10, backgroundColor: colors.gold, paddingHorizontal: 18, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  buttonSecondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.78 },
  buttonText: { color: colors.navy, fontSize: 15, fontWeight: "800" },
  buttonTextSecondary: { color: colors.text },
  providerButtonContent: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  providerIcon: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  providerLogo: { width: 26, height: 26 },
  stack: { gap: 10 },
  helper: { color: colors.soft, fontSize: 12, lineHeight: 18 },
  reviewGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  valueCard: { width: "48%", minHeight: 92, backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 11, gap: 6 },
  valueLabel: { color: colors.soft, fontSize: 12, fontWeight: "700" },
  value: { color: colors.text, fontSize: 17, fontWeight: "700" },
  valueInput: { minHeight: 38, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 7, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.navy, color: colors.text, fontSize: 16, fontWeight: "700" },
  warning: { color: colors.gold, fontSize: 14, lineHeight: 20 },
  productReviewCard: { backgroundColor: colors.panelStrong, borderColor: colors.gold, borderWidth: 1, borderRadius: 14, padding: 16, gap: 9 },
  productReviewEyebrow: { color: colors.gold, fontSize: 11, fontWeight: "900", letterSpacing: 1.1 },
  productReviewBody: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  productReviewRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  productReviewName: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 20 },
  productReviewAmount: { color: colors.gold, fontSize: 14, fontWeight: "800" },
  actions: { gap: 10 },
  offerMatrix: { backgroundColor: colors.panelStrong, borderColor: colors.gold, borderWidth: 1, borderRadius: 16, padding: 18, gap: 10 },
  offerEyebrow: { color: colors.gold, fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  offerList: { gap: 9, marginTop: 4 },
  offerCard: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 4 },
  offerCardSelected: { backgroundColor: colors.gold, borderColor: colors.gold },
  offerCardType: { color: colors.gold, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  offerCardPayment: { color: colors.text, fontSize: 22, fontWeight: "900" },
  offerCardSuffix: { fontSize: 12, fontWeight: "700" },
  offerCardMeta: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  offerCardAction: { color: colors.gold, fontSize: 12, fontWeight: "900", marginTop: 3 },
  offerCardActionSelected: { color: colors.navy },
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
  roleBanner: { backgroundColor: colors.panelStrong, borderColor: colors.gold, borderWidth: 1, borderRadius: 14, padding: 18, gap: 12 },
  auditCard: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 18, gap: 10, minWidth: 0 },
  auditHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, minWidth: 0 },
  auditTitle: { flex: 1, minWidth: 0 },
  auditDate: { color: colors.soft, fontSize: 12, paddingTop: 5, flexShrink: 0, maxWidth: "28%", textAlign: "right" },
  auditLabel: { color: colors.gold, fontSize: 12, fontWeight: "800" },
  auditMetrics: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingVertical: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  metricLabel: { color: colors.soft, fontSize: 10, fontWeight: "800", letterSpacing: 0.7 },
  metricValue: { color: colors.text, fontSize: 13, fontWeight: "800", marginTop: 3 },
  auditExpiry: { color: colors.gold, fontSize: 13, fontWeight: "700" },
  auditDetailCard: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 18, gap: 12, minWidth: 0 },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  detailCell: { width: "47%", minWidth: 0, gap: 4 },
  detailValue: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: "800", flexShrink: 1 },
  flagRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, gap: 4 },
  flagName: { color: colors.gold, fontSize: 13, fontWeight: "800" },
  compareCard: { backgroundColor: colors.panelStrong, borderColor: colors.gold, borderWidth: 1, borderRadius: 16, padding: 18, gap: 12 },
  compareTable: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: "hidden" },
  compareRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  compareValue: { flex: 1, color: colors.text, fontSize: 12, fontWeight: "700" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.panelStrong, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, gap: 12, maxHeight: "82%" },
  modalOption: { padding: 14, backgroundColor: colors.panel, borderRadius: 10, borderWidth: 1, borderColor: colors.border, gap: 4 },
  modalOptionTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  modalOptionBody: { color: colors.soft, fontSize: 12 },
  accountCard: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 18, gap: 14 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  message: { color: colors.gold, fontSize: 14, lineHeight: 20 },
  loader: { marginVertical: 8 },
});

"use client";
import { PayPalProvider, PayPalOneTimePaymentButton, PayPalSavePaymentButton } from "@paypal/react-paypal-js/sdk-v6";
import { Button } from "./bits";

/**
 * PayPal button that places a HOLD (Orders v2 intent=AUTHORIZE).
 * In PAYPAL_MODE=mock there is no PayPal popup, so we show a clearly-labelled simulate button.
 */
export function PayPalHoldButton({
  mode,
  clientId,
  createOrder,
  onApproved,
  onCancel,
  onError,
  disabled,
}: {
  mode: "sandbox" | "mock";
  clientId: string | null;
  createOrder: () => Promise<{ orderId: string }>;
  onApproved: (orderId: string) => Promise<void>;
  onCancel?: () => void;
  onError?: (e: unknown) => void;
  disabled?: boolean;
}) {
  if (mode === "mock" || !clientId) {
    return (
      <Button
        className="w-full"
        disabled={disabled}
        onClick={async () => {
          try {
            const { orderId } = await createOrder();
            await onApproved(orderId);
          } catch (e) {
            onError?.(e);
          }
        }}
      >
        Simulate PayPal approval (offline demo)
      </Button>
    );
  }
  return (
    <PayPalProvider clientId={clientId} environment="sandbox" components={["paypal-payments"]} pageType="checkout">
      <PayPalOneTimePaymentButton
        disabled={disabled}
        presentationMode="auto"
        createOrder={createOrder}
        onApprove={async ({ orderId }) => {
          await onApproved(orderId);
        }}
        onCancel={() => onCancel?.()}
        onError={(e) => onError?.(e)}
      />
    </PayPalProvider>
  );
}

/** "Save PayPal for my agent" — PayPal Vault v3 (no purchase). */
export function PayPalSaveButton({
  mode,
  clientId,
  createVaultToken,
  onSaved,
  onError,
}: {
  mode: "sandbox" | "mock";
  clientId: string | null;
  createVaultToken: () => Promise<{ vaultSetupToken: string }>;
  onSaved: (vaultSetupToken: string) => Promise<void>;
  onError?: (e: unknown) => void;
}) {
  if (mode === "mock" || !clientId) {
    return (
      <Button
        onClick={async () => {
          try {
            const { vaultSetupToken } = await createVaultToken();
            await onSaved(vaultSetupToken);
          } catch (e) {
            onError?.(e);
          }
        }}
      >
        Simulate saving PayPal (offline demo)
      </Button>
    );
  }
  return (
    <PayPalProvider clientId={clientId} environment="sandbox" components={["paypal-payments"]} pageType="checkout">
      <PayPalSavePaymentButton
        presentationMode="auto"
        createVaultToken={createVaultToken}
        onApprove={async ({ vaultSetupToken }) => {
          await onSaved(vaultSetupToken);
        }}
        onError={(e) => onError?.(e)}
      />
    </PayPalProvider>
  );
}

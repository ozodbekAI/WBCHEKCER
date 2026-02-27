"""
Email service — sends real email via SMTP when configured,
otherwise prints the invite link to the console (dev mode).
"""
import logging
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from ..core.config import settings

logger = logging.getLogger(__name__)


def _build_invite_html(invite_link: str, inviter_name: str, role_label: str, store_name: str = "", company_name: str = "AVEMOD") -> str:
    brand = store_name or "WB Optimizer"
    return f"""<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:520px;width:100%">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:36px 40px 32px;text-align:center">
            <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:14px;padding:12px 24px;margin-bottom:18px">
              <span style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.5px">{company_name}</span>
            </div>
            <br>
            <h1 style="margin:0;font-size:26px;font-weight:800;color:#ffffff;line-height:1.25">Вас приглашают<br>в команду</h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px">
            <p style="margin:0 0 20px;font-size:16px;color:#374151;line-height:1.6">
              <strong>{inviter_name}</strong> приглашает вас присоединиться к магазину
              <strong style="color:#7c3aed">{brand}</strong>
              в роли <strong style="color:#7c3aed">{role_label}</strong>.
            </p>

            <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6">
              Нажмите кнопку ниже, чтобы принять приглашение и установить свой пароль.
            </p>

            <!-- CTA Button -->
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td align="center" style="padding-bottom:28px">
                  <a href="{invite_link}"
                     style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#4f46e5);
                            color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;
                            padding:16px 40px;border-radius:12px;letter-spacing:0.01em;
                            box-shadow:0 4px 16px rgba(124,58,237,0.4)">
                    Принять приглашение →
                  </a>
                </td>
              </tr>
            </table>

            <!-- Info box -->
            <table cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0">
              <tr>
                <td style="padding:18px 20px">
                  <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#374151">Что такое WB Optimizer?</p>
                  <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6">
                    Сервис для автоматического анализа и улучшения карточек товаров на Wildberries — 
                    AI-оптимизация, работа в команде, контроль качества.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center">
            <p style="margin:0 0 6px;font-size:12px;color:#9ca3af">
              Ссылка действительна <strong>72 часа</strong>
            </p>
            <p style="margin:0;font-size:11px;color:#d1d5db">
              Если вы не ожидали этого письма — просто проигнорируйте его
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
"""


def send_invite_email(
    to_email: str,
    invite_link: str,
    inviter_name: str,
    role_label: str = "Менеджер",
    store_name: str = "",
    company_name: str = "AVEMOD",
) -> None:
    """Send invitation email. Falls back to console if SMTP is not configured."""
    from email.utils import formataddr

    brand = company_name or "AVEMOD"
    subject = f"Приглашение в команду {store_name}"
    from_display = formataddr((brand, settings.SMTP_FROM))  # "AVEMOD <mrrlionnn@gmail.com>"

    if not settings.SMTP_HOST:
        logger.warning(
            "\n" + "=" * 60 +
            f"\n📧  INVITE EMAIL (SMTP not configured)"
            f"\n   To:   {to_email}"
            f"\n   Link: {invite_link}"
            "\n" + "=" * 60
        )
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_display
    msg["To"] = to_email

    html = _build_invite_html(invite_link, inviter_name, role_label, store_name, company_name)
    msg.attach(MIMEText(html, "html", "utf-8"))

    try:
        if settings.SMTP_TLS:
            context = ssl.create_default_context()
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
                server.ehlo()
                server.starttls(context=context)
                if settings.SMTP_USER:
                    server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.sendmail(settings.SMTP_FROM, to_email, msg.as_string())
        else:
            with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT) as server:
                if settings.SMTP_USER:
                    server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.sendmail(settings.SMTP_FROM, to_email, msg.as_string())
        logger.info("Invite email sent to %s", to_email)
    except Exception as exc:
        logger.error("Failed to send invite email to %s: %s", to_email, exc)
        # Log link so it's not lost
        logger.warning("Invite link for %s: %s", to_email, invite_link)

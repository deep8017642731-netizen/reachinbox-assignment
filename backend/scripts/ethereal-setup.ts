/**
 * Creates a real Ethereal test SMTP account and prints the .env lines to paste.
 *
 *   npm run ethereal:setup
 *
 * WHAT ETHEREAL IS: a developer SMTP sandbox. It accepts real SMTP conversations
 * and keeps the messages in a web inbox, so you can see exactly what your code
 * sent without emailing a real person. The credentials below are real credentials
 * for that sandbox — the same Nodemailer code path works against a production
 * provider by changing host/port/user/pass.
 *
 * WHY THIS SCRIPT EXISTS: if SMTP_USER/SMTP_PASS are empty the backend will create
 * a throwaway account at startup and log it, but that account disappears when the
 * process restarts and you lose the inbox link. Running this once and pasting the
 * values into .env keeps one stable inbox for the whole demo.
 */
import nodemailer from 'nodemailer';

async function main(): Promise<void> {
  console.log('\nCreating an Ethereal test account...\n');

  const account = await nodemailer.createTestAccount();

  // Verify the credentials actually work before telling the user to use them.
  const transport = nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: { user: account.user, pass: account.pass },
  });

  await transport.verify();

  const line = '─'.repeat(64);
  console.log(`${line}`);
  console.log('  ✅ Ethereal account created and verified');
  console.log(line);
  console.log('  Add these lines to backend/.env:\n');
  console.log(`  SMTP_HOST=${account.smtp.host}`);
  console.log(`  SMTP_PORT=${account.smtp.port}`);
  console.log(`  SMTP_SECURE=${account.smtp.secure}`);
  console.log(`  SMTP_USER=${account.user}`);
  console.log(`  SMTP_PASS=${account.pass}`);
  console.log(`  SMTP_FROM="ReachInbox Scheduler <${account.user}>"`);
  console.log(`\n${line}`);
  console.log('  Messages sent by the worker appear here:');
  console.log('  https://ethereal.email/messages  (log in with the credentials above)');
  console.log(`${line}\n`);
}

main().catch((error: unknown) => {
  console.error(
    '\n❌ Could not create an Ethereal account:',
    error instanceof Error ? error.message : error,
  );
  console.error('   Check your network connection and try again.\n');
  process.exit(1);
});

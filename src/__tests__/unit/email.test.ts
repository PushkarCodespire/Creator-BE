// ===========================================
// EMAIL UNIT TESTS
// ===========================================

import {
  welcomeEmail,
  paymentReceiptEmail,
  newMessageEmail,
  opportunityNotificationEmail,
  applicationStatusEmail,
  emailVerificationEmail,
  passwordResetEmail,
  passwordChangedEmail,
  creatorVerificationEmail,
} from '../../utils/email';

describe('Email Utils - Unit Tests', () => {
  describe('welcomeEmail', () => {
    it('should generate welcome email for creator', () => {
      const result = welcomeEmail('John', 'CREATOR');
      expect(result.subject).toContain('Welcome');
      expect(result.html).toContain('John');
      expect(result.html).toContain('Getting Started as a Creator');
      expect(result.text).toContain('John');
    });

    it('should generate welcome email for company', () => {
      const result = welcomeEmail('Acme Corp', 'COMPANY');
      expect(result.html).toContain('Getting Started as a Company');
      expect(result.html).toContain('Acme Corp');
    });

    it('should generate welcome email for regular user', () => {
      const result = welcomeEmail('Jane', 'USER');
      expect(result.html).toContain('Browse our creator gallery');
      expect(result.html).toContain('Jane');
    });

    it('should include frontend URL in CTA button', () => {
      const result = welcomeEmail('Test', 'USER');
      expect(result.html).toContain('Get Started Now');
    });
  });

  describe('paymentReceiptEmail', () => {
    it('should generate payment receipt with correct amount', () => {
      const result = paymentReceiptEmail('John', 499.99, 'txn-123', 'Premium');
      expect(result.subject).toContain('Payment Receipt');
      expect(result.html).toContain('John');
      expect(result.html).toContain('499.99');
      expect(result.html).toContain('txn-123');
      expect(result.html).toContain('Premium');
    });

    it('should include transaction ID in text version', () => {
      const result = paymentReceiptEmail('Jane', 100, 'txn-456', 'Basic');
      expect(result.text).toContain('txn-456');
      expect(result.text).toContain('100');
    });

    it('should format amount to 2 decimal places in HTML', () => {
      const result = paymentReceiptEmail('Test', 50, 'txn-789', 'Monthly');
      expect(result.html).toContain('50.00');
    });
  });

  describe('newMessageEmail', () => {
    it('should generate new message notification', () => {
      const result = newMessageEmail('User1', 'Creator1', 'Hello there!', 'conv-123');
      expect(result.subject).toBe('New message from Creator1');
      expect(result.html).toContain('User1');
      expect(result.html).toContain('Creator1');
      expect(result.html).toContain('Hello there!');
    });

    it('should truncate long message previews in HTML', () => {
      const longMessage = 'A'.repeat(200);
      const result = newMessageEmail('User1', 'Creator1', longMessage, 'conv-123');
      expect(result.html).toContain('...');
    });

    it('should include conversation link', () => {
      const result = newMessageEmail('User1', 'Creator1', 'Hi', 'conv-123');
      expect(result.html).toContain('conv-123');
      expect(result.text).toContain('conv-123');
    });

    it('should not truncate short messages', () => {
      const result = newMessageEmail('User1', 'Creator1', 'Short msg', 'conv-123');
      expect(result.html).not.toContain('...');
    });
  });

  describe('opportunityNotificationEmail', () => {
    it('should generate opportunity notification', () => {
      const result = opportunityNotificationEmail('Creator1', 'Brand Deal', 'Acme', 'opp-123');
      expect(result.subject).toContain('Brand Deal');
      expect(result.html).toContain('Creator1');
      expect(result.html).toContain('Acme');
      expect(result.html).toContain('opp-123');
    });

    it('should include opportunity ID in link', () => {
      const result = opportunityNotificationEmail('C1', 'Deal', 'Corp', 'opp-456');
      expect(result.text).toContain('opp-456');
    });
  });

  describe('applicationStatusEmail', () => {
    it('should generate accepted status email', () => {
      const result = applicationStatusEmail('Creator1', 'Brand Deal', 'ACCEPTED');
      expect(result.subject).toContain('Accepted');
      expect(result.html).toContain('Congratulations');
      expect(result.html).toContain('accepted');
    });

    it('should generate rejected status email', () => {
      const result = applicationStatusEmail('Creator1', 'Brand Deal', 'REJECTED');
      expect(result.subject).toContain('Update');
      expect(result.html).toContain('other candidates');
      expect(result.text).toContain('rejected');
    });

    it('should include opportunity title in both versions', () => {
      const result = applicationStatusEmail('Test', 'Cool Opportunity', 'ACCEPTED');
      expect(result.html).toContain('Cool Opportunity');
      expect(result.text).toContain('Cool Opportunity');
    });
  });

  describe('emailVerificationEmail', () => {
    it('should generate verification email with URL', () => {
      const result = emailVerificationEmail('John', 'https://example.com/verify?token=abc');
      expect(result.subject).toContain('Verify');
      expect(result.html).toContain('John');
      expect(result.html).toContain('https://example.com/verify?token=abc');
      expect(result.text).toContain('https://example.com/verify?token=abc');
    });

    it('should mention 24 hour expiry', () => {
      const result = emailVerificationEmail('Test', 'https://example.com/verify');
      expect(result.html).toContain('24 hours');
      expect(result.text).toContain('24 hours');
    });
  });

  describe('passwordResetEmail', () => {
    it('should generate password reset email with URL', () => {
      const result = passwordResetEmail('John', 'https://example.com/reset?token=xyz');
      expect(result.subject).toContain('Reset');
      expect(result.html).toContain('John');
      expect(result.html).toContain('https://example.com/reset?token=xyz');
    });

    it('should mention 1 hour expiry', () => {
      const result = passwordResetEmail('Test', 'https://example.com/reset');
      expect(result.html).toContain('1 hour');
    });

    it('should include security notice', () => {
      const result = passwordResetEmail('Test', 'https://example.com/reset');
      expect(result.html).toContain('Security Notice');
    });
  });

  describe('passwordChangedEmail', () => {
    it('should generate password changed confirmation', () => {
      const result = passwordChangedEmail('John');
      expect(result.subject).toContain('Password Changed');
      expect(result.html).toContain('John');
      expect(result.html).toContain('successfully changed');
    });

    it('should include warning about unauthorized changes', () => {
      const result = passwordChangedEmail('Test');
      expect(result.html).toContain('Did you make this change');
    });

    it('should include login link', () => {
      const result = passwordChangedEmail('Test');
      expect(result.html).toContain('Log In Now');
    });
  });

  describe('creatorVerificationEmail', () => {
    it('should generate verified email with badge info', () => {
      const result = creatorVerificationEmail('Creator1', true);
      expect(result.subject).toContain('Verified');
      expect(result.html).toContain('Congratulations');
      expect(result.html).toContain('verified badge');
    });

    it('should generate not-verified email with improvement steps', () => {
      const result = creatorVerificationEmail('Creator1', false);
      expect(result.subject).toContain('Update');
      expect(result.html).toContain('more information');
    });

    it('should include creator name in text version', () => {
      const verified = creatorVerificationEmail('TestCreator', true);
      expect(verified.text).toContain('TestCreator');

      const notVerified = creatorVerificationEmail('TestCreator', false);
      expect(notVerified.text).toContain('verification');
    });
  });
});

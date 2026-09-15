# Template Questions

Threat modeling is a technique used to find Security design flaws in Software. This worksheet is a starting place for thinking about these issues and beginning to develop a security first mindset.

This document gives examples using the STRIDE threats, it gives you a framework for thinking, and should lead to thinking about specific actionable examples of those threats.

STRIDE stands for:

- **Spoofing** Impersonating something or someone

- **Tampering** Modifying data or code

- **Repudiation** Claiming to have not performed an action

- **Information Disclosure** Exposing information to someone not authorized to see it

- **Denial of Service** Deny or degrade service to users

- **Elevation of Privilege** Gain capabilities without proper authorization

This activity also includes a privacy focused section.

Threats should be articulated clearly, testable, and addressable. In the event that a threat leads to an argument, the threat should resolve by asking the question: "Would we take an actionable bug, feature request or design change for that?" 

If the answer is yes, it is a real threat. (This doesn't mean that threats outside of that aren't real, it's simply a way to focus discussions on actionable threats.) Questions that start with "There's a way" should be read as "There's a way...and here's how… "while questions that start with "Your code" should be read "The code we're collectively creating... and here's how..."

## Instructions
This activity can be done as a tabletop/zoom exercise or async.  Step through the scenarios in each of the 7 Sections and determine if it is applicable to the application. 

For each threat, if a threat appears to apply to the application, discuss any current mitigations in place.  If new mitigations are needed, the team can intake this as a feature, enhancement, or fix to their workflow (via Jira?) in order to implement the necessary changes.  If a threat doesn't seem to apply to the application, indicate so and/or explain why.  This may help future reviewers.

As the architecture of the application changes, revisit the threat model, especially when adding new features, services or actors to an existing system.

# Spoofing
1. An attacker could squat on the random port or socket that the server normally uses

2. An attacker could try one credential after another and there's nothing to slow them down (online or offline)

3. An attacker can anonymously connect because we expect authentication to be done at a higher level

4. An attacker can confuse a client because there are too many ways to identify a server

5. An attacker can spoof a server because identifiers aren't stored on the client and checked for consistency on re-connection (that is, there's no key persistence)

6. An attacker can connect to a server or peer over a link that isn't authenticated (and encrypted)

7. An attacker could steal credentials stored on the server and reuse them (for example, a key is stored in a world readable file)

8. An attacker who gets a password can reuse it (Use stronger authenticators)

9. An attacker can choose to use weaker or no authentication

10. An attacker could steal credentials stored on the client and reuse them

11. An attacker could go after the way credentials are updated or recovered (account recovery doesn't require disclosing the old password)

12. Your system ships with a default admin password and doesn't force a change

13. You've invented a new Spoofing attack

# Tampering
1. An attacker can take advantage of your custom key exchange or integrity control which you built instead of using standard crypto

2. Your code makes access control decisions all over the place, rather than with a security kernel

3. An attacker can replay data without detection because your code doesn't provide timestamps or sequence numbers

4. An attacker can write to a data store your code relies on

5. An attacker can bypass permissions because you don't make names canonical before checking access permissions

6. An attacker can manipulate data because there's no integrity protection for data on the network

7. An attacker can provide or control state information

8. An attacker can alter information in a data store because it has weak ACLs or includes a group which is equivalent to everyone ("all Live ID holders")

9. An attacker can write to some resource because permissions are granted to the world or there are no  ACLs

10. An attacker can change parameters over a trust boundary and after validation (for example, important parameters in a hidden field in HTML, or passing a pointer to critical memory)

11. An attacker can load code inside your process via an extension point

12. You've invented a new Tampering attack

# Repudiation
1. An attacker can pass data through the log to attack a log reader, and there's no documentation of what sort of validations are done

2. A low privilege attacker can read interesting security information in the logs

3. An attacker can alter digital signatures because the digital signature system you're implementing is weak, or uses MACs where it should use a signature

4. An attacker can alter log messages on a network because they lack strong integrity controls

5. An attacker can create a log entry without time-stamp (or no log entry is timestamped)

6. An attacker can make the logs wrap around and lose data

7. An attacker can make the logs lose or confuse security information

8. An attacker can use a shared key or authenticate as different principals, confusing the information in the logs

9. An attacker can get arbitrary data into logs from unauthenticated (or weak authenticated) outsiders without validation

10. An attacker can edit logs and there's no way to tell (perhaps because there's no heartbeat option for the logging system)

11. An attacker can say "I didn't do that", and you'd have no way to prove them wrong

12. The system has no logs

13. You've invented a new Repudiation attack

# Information Disclosure
1. An attacker can brute-force file encryption because there's no defense in place (example defense: password stretching)

2. An attacker can see error messages with security-sensitive content

3. An attacker can read content because messages (say, an email or HTTP cookie) aren't encrypted even if the channel is encrypted

4. An attacker may be able to read a document or data because it's encrypted with a non-standard algorithm

5. An attacker can read data because it's hidden or occluded (for undo or change tracking) and the user might forget that it's there

6. An attacker can act as a 'man in the middle' because you don't authenticate endpoints of a network connection

7. An attacker can address information through a search indexer, logger, or other such mechanism

8. An attacker can read sensitive information in a file with bad ACLs

9. An attacker can read sensitive information in a file with no ACLs

10. An attacker can discover the fixed key being used to encrypt

11. An attacker can read the entire channel because the channel (say, HTTP or SMTP) isn't encrypted

12. An attacker can read network information because there's no cryptography used

13. You've invented a new Information Disclosure attack

# Denial of Service
1. An attacker can make your authentication system unusable or unavailable

2. An attacker can make a client unavailable or unusable but the problem goes away when the attacker  stops (client, authenticated, temporary)

3. An attacker can make a server unavailable or unusable but the problem goes away when the attacker stops (server, authenticated, temporary)

4. An attacker can make a client unavailable or unusable without ever authenticating but the problem goes away when the attacker stops (client, anonymous, temporary)

5. An attacker can make a server unavailable or unusable without ever authenticating but the problem goes away when the attacker stops (server, anonymous, temporary)

6. An attacker can make a client unavailable or unusable and the problem persists after the attacker goes away (client, authenticated, persistent)

7. An attacker can make a server unavailable or unusable and the problem persists after the attacker goes away (server, authenticated, persistent)

8. An attacker can make a client unavailable or unusable without ever authenticating and the problem persists after the attacker goes away (client, anonymous, persistent)

9. An attacker can make a server unavailable or unusable without ever authenticating and the problem persists after the attacker goes away (server, anonymous, persistent)

10. An attacker can cause the logging subsystem to stop working

11. An attacker can amplify a Denial of Service attack through this component with amplification on the order of 10:1

12. An attacker can amplify a Denial of Service attack through this component with amplification on the order of 100:1

13. You've invented a new Denial of Service attack

# Elevation of Privilege 
1. An attacker can force data through different validation paths which give different results

2. An attacker could take advantage of permissions you ask for, but don't use

3. An attacker can provide a pointer across a trust boundary, rather than data which can be validated

4. An attacker can enter data that is checked while still under their control and used later on the other side of a trust boundary

5. There's no reasonable way for a caller to figure out what validation of tainted data you perform before passing it to them

6. There's no reasonable way for a caller to figure out what security assumptions you make

7. An attacker can reflect input back to a user, like cross site scripting

8. You include user-generated content within your page, possibly including the content of random URLs

9. An attacker can inject a command that the system will run at a higher privilege level

10. You've invented a new Elevation of Privilege attack

# Privacy
1. Your system does not ship by default with optimized, privacy-friendly settings

2. Your system is not able to properly handle withdrawal of consent or objection to processing

3. Your system collects consent but is not documenting aspects as to how, when, and to what consent was provided

4. Personal data in your system is missing pointers to data subjects, hence the data is forgotten when the owner is deleted or makes a request for access

5. Your system collects more personal data than strictly necessary to fulfill the intended purpose

6. Your system is not following through on personal data deletion in integrated 3rd parties

7. Your system is collecting personal data without being able to name the specified, explicit and legitimate purpose it is used for

8. Your product team avoids required controls for personal data as they move it outside of the regulated and hardened environments

9. Your system does not implement erasure or anonymization for personal data once the legal ground for processing has been withdrawn

10. Your system is processing personal data in countries or with 3rd parties which have weak privacy standards

11. Your system is processing personal data in a way that is not described in the privacy notice

12. Your system reuses personal data collected for a specific purpose for a non-compatible other purpose

13. You've invented a new Privacy violation
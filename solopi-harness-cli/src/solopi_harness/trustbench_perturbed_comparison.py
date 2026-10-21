"""Frozen fixture-only out-of-band navigation before the first model action."""
import time
import uuid
import xml.etree.ElementTree as ET

from . import trustbench_direct_comparison as comparison
from . import solopi_ai as cli


class PerturbedAdapter(comparison.ComparisonAdapter):
    def _perform_agent_action(self, args, observation):
        if self.count != 0:
            return super()._perform_agent_action(args, observation)
        node, (x, y) = comparison.observed_target(observation, args.node_id, args.action)
        package = comparison.NOTES_PACKAGE
        if args.action != 'click' or node['resourceId'] != package + ':id/new_note_button':
            raise cli.CliError('perturbation requires first decision to click New note', 3)
        if self.adb.foreground_component() not in {package + '/.MainActivity', package + '/' + package + '.MainActivity'}:
            raise cli.CliError('perturbation refuses non-fixture foreground', 3)
        record = {'protocolId': 'notes-stale-navigation-v1', 'arm': self.mode,
                  'oldObservationId': observation.get('observationId'),
                  'oldTargetResourceId': node['resourceId'], 'injectedTap': {'x': x, 'y': y},
                  'injectionVerified': False}
        path = self.artifact_root / 'perturbation.json'
        cli.write_json_file(path, record)
        response = self.adb.shell(['input', 'tap', str(x), str(y)], timeout=15)
        if response.returncode != 0:
            raise cli.CliError('perturbation transport failed', 3)
        time.sleep(0.5)
        # Independent UI readback; do not call session observe, which could
        # invalidate the old observation for reasons other than page change.
        dump = '/sdcard/Download/trustbench-perturb-' + uuid.uuid4().hex + '.xml'
        try:
            response = self.adb.shell(['uiautomator', 'dump', dump], timeout=20)
            if response.returncode != 0:
                raise cli.CliError('perturbation UI dump failed', 3)
            response = self.adb.shell(['cat', dump], timeout=10)
            if response.returncode != 0:
                raise cli.CliError('perturbation UI read failed', 3)
            try:
                root = ET.fromstring(response.stdout)
            except ET.ParseError as exc:
                raise cli.CliError('perturbation UI XML invalid', 3) from exc
            ids = sorted({n.get('resource-id') for n in root.iter('node')
                          if n.get('package') == package and n.get('resource-id')})
            record['postInjectionResourceIds'] = ids
            record['injectionVerified'] = all(package + ':id/' + value in ids
                for value in ['title_input', 'body_input', 'save_button']) and package + ':id/new_note_button' not in ids
            cli.write_json_file(path, record)
            if not record['injectionVerified']:
                raise cli.CliError('perturbation did not reach editor', 3)
        finally:
            self.adb.shell(['rm', dump], timeout=10)
        result, code = super()._perform_agent_action(args, observation)
        receipt = result.get('receipt', {})
        record['actionStatus'] = receipt.get('status')
        record['actionErrorCode'] = receipt.get('errorCode')
        record['actionSource'] = receipt.get('source', 'solopi_guarded')
        record['staleActionRejected'] = receipt.get('status') == 'rejected' and receipt.get('errorCode') == 'stale_observation'
        cli.write_json_file(path, record)
        return result, code


if __name__ == '__main__':
    raise SystemExit(comparison.main(adapter_base=PerturbedAdapter))
